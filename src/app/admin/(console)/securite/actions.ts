'use server';

import QRCode from 'qrcode';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/org';
import { disableTotp, enableTotp } from '@/lib/auth';
import { enrollmentUri, generateSecret } from '@/lib/security/totp';
import { issue, verify } from '@/lib/security/signed';
import { consume } from '@/lib/security/rate-limit';

/**
 * Configuration de la double authentification.
 *
 * Le secret proposé à l'enrôlement ne va **pas** en base tant que l'utilisateur
 * n'a pas prouvé qu'il l'a bien enregistré. Il transite dans un jeton signé de
 * dix minutes : ni modifiable par le client, ni persistant, ni réutilisable
 * ailleurs.
 *
 * Sans cette précaution, le scénario habituel se produit : le secret est
 * enregistré, l'utilisateur ferme l'onglet avant de scanner, et son compte se
 * retrouve verrouillé par une protection jamais terminée.
 */

export interface EnrollmentState {
  error: string | null;
  secret?: string;
  /** Jeton signé transportant le secret jusqu'à la confirmation. */
  enrollmentToken?: string;
  qrDataUrl?: string;
  /** Affichés une seule fois, après activation. */
  recoveryCodes?: string[];
  done?: boolean;
}

const ENROLLMENT_TTL = 600;

export async function startEnrollmentAction(): Promise<EnrollmentState> {
  const user = await requireUser();

  const secret = generateSecret();
  const uri = enrollmentUri(secret, user.email, 'Les Nuits de la Garonne');

  return {
    error: null,
    secret,
    enrollmentToken: issue('totp-enroll', { userId: user.id, secret }, ENROLLMENT_TTL),
    qrDataUrl: await QRCode.toDataURL(uri, { width: 240, margin: 1 }),
  };
}

export async function confirmEnrollmentAction(
  _prev: EnrollmentState,
  formData: FormData,
): Promise<EnrollmentState> {
  const user = await requireUser();

  const limit = await consume('totp', `enroll:${user.id}`);
  if (!limit.allowed) {
    return { error: 'Trop de tentatives. Patientez quelques minutes.' };
  }

  const token = String(formData.get('enrollmentToken') ?? '');
  const payload = verify<{ userId: string; secret: string }>('totp-enroll', token);

  // Le jeton porte l'identifiant : impossible d'activer le second facteur sur le
  // compte de quelqu'un d'autre en rejouant un formulaire.
  if (!payload || payload.userId !== user.id) {
    return { error: "La configuration a expiré. Recommencez l'opération." };
  }

  const result = await enableTotp(user.id, payload.secret, String(formData.get('code') ?? ''));

  if (!result.ok) {
    return {
      error: 'Code incorrect. Vérifiez que l’heure de votre téléphone est à jour.',
      secret: payload.secret,
      enrollmentToken: token,
      qrDataUrl: await QRCode.toDataURL(
        enrollmentUri(payload.secret, user.email, 'Les Nuits de la Garonne'),
        { width: 240, margin: 1 },
      ),
    };
  }

  revalidatePath('/admin/securite');
  return { error: null, done: true, recoveryCodes: result.recoveryCodes };
}

export async function disableTotpAction(
  _prev: { error: string | null; ok?: boolean },
  formData: FormData,
): Promise<{ error: string | null; ok?: boolean }> {
  const user = await requireUser();

  const limit = await consume('totp', `disable:${user.id}`);
  if (!limit.allowed) return { error: 'Trop de tentatives. Patientez quelques minutes.' };

  // Le mot de passe est redemandé : retirer une protection ne doit pas être
  // possible depuis un onglet resté ouvert sur un poste partagé.
  const ok = await disableTotp(user.id, String(formData.get('password') ?? ''));
  if (!ok) return { error: 'Mot de passe incorrect.' };

  revalidatePath('/admin/securite');
  return { error: null, ok: true };
}
