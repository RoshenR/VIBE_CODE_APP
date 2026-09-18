import { NextResponse } from 'next/server';
import { db } from '@/db';
import { consumeOffer, getOffer, WaitlistError } from '@/server/waitlist';
import { createHold, OrderError } from '@/server/orders';
import { startCheckout } from '@/server/payments';
import { acceptOfferSchema } from '@/lib/validation';
import { guardOrigin } from '@/lib/api-auth';
import { consume, tooManyRequests } from '@/lib/security/rate-limit';
import {
  clientIp,
  payloadTooLarge,
  PayloadTooLargeError,
  readJsonBody,
} from '@/lib/security/request';

/**
 * Acceptation d'une offre de liste d'attente.
 *
 * Les places sont **déjà détenues** depuis l'envoi de l'offre : la commande est
 * donc créée avec `seatsAlreadyHeld`, sans repasser par une réservation. C'est ce
 * qui garantit que la personne à qui on a écrit « une place se libère » la trouve
 * effectivement disponible.
 *
 * `consumeOffer` verrouille l'offre : deux ouvertures simultanées du même lien ne
 * peuvent pas créer deux commandes.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  const limit = await consume('cancel', `offre:${clientIp(request)}`);
  if (!limit.allowed) return tooManyRequests(limit);

  const { token } = await params;

  let payload: unknown;
  try {
    payload = await readJsonBody(request);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return payloadTooLarge();
    return NextResponse.json({ error: 'Requête illisible.' }, { status: 400 });
  }

  const parsed = acceptOfferSchema.safeParse({ ...(payload as object), offerToken: token });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Données invalides.' },
      { status: 400 },
    );
  }

  const input = parsed.data;

  try {
    const { entry, event } = await getOffer(token);

    const { order } = await createHold({
      eventId: event.id,
      lines: [{ ticketTypeId: entry.ticketTypeId!, quantity: entry.quantity }],
      customer: {
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        timezone: input.timezone ?? null,
      },
      paymentMethod: input.paymentMethod,
      seatsAlreadyHeld: true,
    });

    const claimed = await db.transaction((tx) => consumeOffer(tx, entry.id, order.id));
    if (!claimed) {
      return NextResponse.json(
        { error: 'Cette offre vient d’être utilisée.' },
        { status: 409 },
      );
    }

    if (order.status === 'paid') {
      return NextResponse.json({ redirectTo: `/commande/${order.manageToken}` });
    }

    const { checkoutUrl } = await startCheckout({
      orderId: order.id,
      reference: order.reference,
      amountCents: order.totalCents,
      currency: order.currency,
      customerEmail: order.customerEmail,
      description: `Commande ${order.reference}`,
    });

    return NextResponse.json({ redirectTo: checkoutUrl });
  } catch (err) {
    if (err instanceof WaitlistError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    if (err instanceof OrderError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    console.error("Échec d'acceptation d'offre", err);
    return NextResponse.json({ error: 'Une erreur est survenue.' }, { status: 500 });
  }
}
