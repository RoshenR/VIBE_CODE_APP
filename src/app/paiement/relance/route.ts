import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { startCheckout } from '@/server/payments';

/**
 * Rouvre une session de paiement pour une réservation en attente.
 *
 * Sert au client qui a fermé son onglet ou qui revient depuis son e-mail. Une
 * commande déjà réglée est redirigée vers ses billets plutôt que vers un second
 * paiement.
 */
export async function GET(request: Request) {
  const orderId = new URL(request.url).searchParams.get('order');
  if (!orderId) return NextResponse.redirect(new URL('/', request.url));

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return NextResponse.redirect(new URL('/', request.url));

  if (order.status !== 'pending') {
    return NextResponse.redirect(new URL(`/commande/${order.manageToken}`, request.url));
  }

  const { checkoutUrl } = await startCheckout({
    orderId: order.id,
    reference: order.reference,
    amountCents: order.totalCents,
    currency: order.currency,
    customerEmail: order.customerEmail,
    description: `Commande ${order.reference}`,
  });

  return NextResponse.redirect(checkoutUrl);
}
