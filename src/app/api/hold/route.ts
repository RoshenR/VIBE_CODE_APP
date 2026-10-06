import { NextResponse } from 'next/server';
import { createHold, OrderError } from '@/server/orders';
import { startCheckout } from '@/server/payments';
import { createHoldSchema } from '@/lib/validation';
import { guardOrigin } from '@/lib/api-auth';
import { consumeAll, tooManyRequests } from '@/lib/security/rate-limit';
import {
  clientIp,
  looksAutomated,
  payloadTooLarge,
  PayloadTooLargeError,
  readJsonBody,
} from '@/lib/security/request';

/**
 * Crée une réservation et ouvre la session de paiement.
 *
 * Défenses appliquées avant tout traitement, dans cet ordre :
 *
 *  1. origine de la requête — une page tierce ne réserve pas à votre place ;
 *  2. taille du corps — pas de JSON de 200 Mo à analyser ;
 *  3. débit, par adresse IP **et** par adresse e-mail ;
 *  4. champ leurre — filtre le bruit de fond des robots ;
 *  5. validation stricte du contenu.
 *
 * La garantie anti-survente, elle, n'est pas ici : elle est en base
 * (`src/server/inventory.ts`). Ce qui est protégé ici, c'est la disponibilité —
 * empêcher quelqu'un de bloquer une salle entière en lançant mille réservations.
 */
export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  let payload: Record<string, unknown>;
  try {
    payload = await readJsonBody<Record<string, unknown>>(request);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return payloadTooLarge();
    return NextResponse.json({ error: 'Requête illisible.' }, { status: 400 });
  }

  // Réponse volontairement normale : signaler au robot qu'il est repéré
  // l'inviterait simplement à contourner le piège.
  if (looksAutomated(payload)) {
    return NextResponse.json({ error: 'Réservation impossible pour le moment.' }, { status: 400 });
  }

  const parsed = createHoldSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // `field` permet à l'interface d'afficher l'erreur contre le bon champ.
    // Information optionnelle : les clients qui l'ignorent restent compatibles.
    return NextResponse.json(
      { error: issue?.message ?? 'Données invalides.', field: issue?.path[0] ?? null },
      { status: 400 },
    );
  }

  const input = parsed.data;

  // Les deux compteurs sont nécessaires : par IP seule, une attaque distribuée
  // passe ; par e-mail seul, il suffit d'en changer à chaque tentative.
  const limit = await consumeAll([
    { rule: 'hold', identifier: `ip:${clientIp(request)}` },
    { rule: 'hold', identifier: `email:${input.email}` },
  ]);
  if (!limit.allowed) {
    return tooManyRequests(limit, 'Trop de réservations en peu de temps. Patientez un instant.');
  }

  try {
    const { order } = await createHold({
      eventSlug: input.eventSlug,
      lines: input.lines,
      customer: {
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        timezone: input.timezone ?? null,
      },
      paymentMethod: input.paymentMethod,
    });

    if (order.status === 'paid') {
      return NextResponse.json({
        orderId: order.id,
        reference: order.reference,
        redirectTo: `/commande/${order.manageToken}`,
      });
    }

    const { checkoutUrl } = await startCheckout({
      orderId: order.id,
      reference: order.reference,
      amountCents: order.totalCents,
      currency: order.currency,
      customerEmail: order.customerEmail,
      description: `Commande ${order.reference}`,
    });

    return NextResponse.json({
      orderId: order.id,
      reference: order.reference,
      manageToken: order.manageToken,
      holdExpiresAt: order.holdExpiresAt?.toISOString() ?? null,
      redirectTo: checkoutUrl,
    });
  } catch (err) {
    if (err instanceof OrderError) {
      const status = err.code === 'sold_out' ? 409 : err.code === 'email_quota' ? 429 : 400;
      return NextResponse.json(
        { error: err.message, code: err.code, details: err.details },
        { status },
      );
    }

    // Le détail part dans les journaux du serveur, pas dans la réponse : un
    // message d'erreur technique renseigne autant l'utilisateur que l'attaquant.
    console.error('Échec de création de réservation', err);
    return NextResponse.json(
      { error: 'Une erreur est survenue. Réessayez dans un instant.' },
      { status: 500 },
    );
  }
}
