'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { completeTotp, signIn, signOut, type RequestContext } from '@/lib/auth';
import { signInSchema } from '@/lib/validation';
import { requireEvent, requireUser } from '@/lib/org';
import { cancelOrder, OrderError } from '@/server/orders';
import { offerNextInLine } from '@/server/waitlist';
import { consumeAll, consume } from '@/lib/security/rate-limit';
import { anonymizeIp } from '@/lib/security/config';
import * as audit from '@/lib/security/audit';

/**
 * Actions serveur de l'espace organisateur.
 *
 * Next.js valide déjà l'origine des actions serveur, ce qui couvre le CSRF. Ce
 * qui est ajouté ici : limitation de débit, verrouillage après échecs, journal
 * d'audit, et vérification des droits.
 */

/**
 * Contexte de la requête courante.
 *
 * L'adresse n'est lue depuis `x-forwarded-for` que si un proxy de confiance est
 * déclaré : sinon, n'importe qui choisit son adresse et échappe aux compteurs.
 */
async function requestContext(): Promise<RequestContext> {
  const headerList = await headers();
  const trusted = process.env.TRUST_PROXY === 'true';
  const raw = trusted ? headerList.get('x-forwarded-for') : null;

  return {
    ipPrefix: anonymizeIp(raw) ?? 'directe',
    userAgent: headerList.get('user-agent')?.slice(0, 250) ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Connexion                                                                  */
/* -------------------------------------------------------------------------- */

export type SignInState = {
  error: string | null;
  /** Bascule le formulaire vers la saisie du code temporaire. */
  needsTotp?: boolean;
};

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const context = await requestContext();

  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  // Message identique à tous les échecs : ne jamais révéler quelles adresses
  // possèdent un compte.
  const GENERIC = 'Adresse e-mail ou mot de passe incorrect.';
  if (!parsed.success) return { error: GENERIC };

  const limit = await consumeAll([
    { rule: 'login', identifier: `ip:${context.ipPrefix}` },
    { rule: 'login', identifier: `email:${parsed.data.email}` },
  ]);

  if (!limit.allowed) {
    return {
      error: `Trop de tentatives. Réessayez dans ${Math.ceil(limit.retryAfter / 60)} minute(s).`,
    };
  }

  const result = await signIn(parsed.data.email, parsed.data.password, context);

  switch (result.status) {
    case 'ok':
      redirect('/admin');
    // eslint-disable-next-line no-fallthrough -- redirect() interrompt l'exécution
    case 'totp_required':
      return { error: null, needsTotp: true };
    case 'locked':
      return {
        error: `Compte temporairement bloqué après plusieurs échecs. Réessayez dans ${Math.ceil(
          result.retryAfter / 60,
        )} minute(s).`,
      };
    default:
      return { error: GENERIC };
  }
}

export async function verifyTotpAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const context = await requestContext();

  const limit = await consume('totp', `ip:${context.ipPrefix}`);
  if (!limit.allowed) {
    return {
      needsTotp: true,
      error: `Trop de tentatives. Réessayez dans ${Math.ceil(limit.retryAfter / 60)} minute(s).`,
    };
  }

  const code = String(formData.get('code') ?? '');
  const result = await completeTotp(code, context);

  switch (result.status) {
    case 'ok':
      redirect('/admin');
    // eslint-disable-next-line no-fallthrough -- redirect() interrompt l'exécution
    case 'locked':
      return {
        needsTotp: true,
        error: `Trop d'échecs. Réessayez dans ${Math.ceil(result.retryAfter / 60)} minute(s).`,
      };
    default:
      return { needsTotp: true, error: 'Code incorrect ou expiré.' };
  }
}

export async function signOutAction(): Promise<void> {
  await signOut(await requestContext());
  redirect('/admin/connexion');
}

/* -------------------------------------------------------------------------- */
/* Commandes                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Annulation d'une commande par l'équipe.
 *
 * Contrairement à l'annulation par le client, aucun délai n'est appliqué :
 * l'organisateur doit pouvoir rembourser à tout moment, y compris le soir même.
 * En contrepartie, l'action est tracée nominativement.
 */
export async function cancelOrderAction(
  orderId: string,
  eventId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { user, event } = await requireEvent(eventId, 'commande.annuler');
  const context = await requestContext();

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  // Le contrôle d'appartenance ne se fie pas à l'identifiant d'événement reçu :
  // il vérifie que la commande relève bien de l'événement chargé depuis la
  // session.
  if (!order || order.eventId !== event.id) return { ok: false, error: 'Commande introuvable.' };

  try {
    await db.transaction(async (tx) => {
      await cancelOrder(tx, orderId, 'organizer');
      await audit.record(
        {
          action: order.status === 'paid' ? 'commande.remboursee' : 'commande.annulee',
          organizationId: user.organizationId,
          userId: user.id,
          targetType: 'order',
          targetId: orderId,
          metadata: {
            reference: order.reference,
            montant_centimes: order.totalCents,
            par: 'organisateur',
          },
          ipPrefix: context.ipPrefix,
          userAgent: context.userAgent,
        },
        tx,
      );
    });
  } catch (err) {
    if (err instanceof OrderError) return { ok: false, error: err.message };
    console.error("Échec d'annulation par l'organisateur", err);
    return { ok: false, error: "L'annulation a échoué. Rien n'a été modifié." };
  }

  await offerNextInLine(event.id).catch(() => undefined);
  revalidatePath(`/admin/evenements/${eventId}/commandes`);
  revalidatePath(`/admin/evenements/${eventId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Contexte partagé                                                           */
/* -------------------------------------------------------------------------- */

/** Réexporté pour les autres modules d'actions (réglages, second facteur). */
export async function currentContext(): Promise<RequestContext> {
  return requestContext();
}

export async function currentUser() {
  return requireUser();
}
