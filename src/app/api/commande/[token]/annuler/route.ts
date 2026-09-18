import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { cancelOrder, OrderError } from '@/server/orders';
import { offerNextInLine } from '@/server/waitlist';
import { guardOrigin } from '@/lib/api-auth';
import { consume, tooManyRequests } from '@/lib/security/rate-limit';
import { clientIp, userAgent } from '@/lib/security/request';
import { anonymizeIp } from '@/lib/security/config';
import * as audit from '@/lib/security/audit';

/**
 * Annulation autonome par le client.
 *
 * Le jeton de gestion tient lieu d'authentification : 32 octets aléatoires,
 * connus du seul destinataire de l'e-mail. Deux conséquences sur la sécurité :
 *
 *  • le contrôle d'origine est **indispensable** ici. Sans lui, une page tierce
 *    ayant aperçu le lien — dans un historique, un journal de serveur mandataire
 *    — pourrait déclencher l'annulation à l'insu du client ;
 *  • la limitation de débit borne le tâtonnement sur les jetons, même s'il est
 *    déjà hors de portée par la seule taille de l'espace de recherche.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  const ip = clientIp(request);
  const limit = await consume('cancel', `ip:${ip}`);
  if (!limit.allowed) return tooManyRequests(limit);

  const { token } = await params;

  const [order] = await db
    .select({
      id: orders.id,
      eventId: orders.eventId,
      organizationId: orders.organizationId,
      reference: orders.reference,
    })
    .from(orders)
    .where(eq(orders.manageToken, token))
    .limit(1);

  if (!order) {
    return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
  }

  try {
    await db.transaction(async (tx) => {
      await cancelOrder(tx, order.id, 'customer', { enforceDeadline: true });
      // La trace vit dans la même transaction que l'annulation : impossible
      // d'annuler sans trace, ni de tracer une annulation qui n'a pas eu lieu.
      await audit.record(
        {
          action: 'commande.annulee',
          organizationId: order.organizationId,
          targetType: 'order',
          targetId: order.id,
          metadata: { reference: order.reference, par: 'client' },
          ipPrefix: anonymizeIp(ip),
          userAgent: userAgent(request),
        },
        tx,
      );
    });
  } catch (err) {
    if (err instanceof OrderError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    console.error("Échec d'annulation", err);
    return NextResponse.json({ error: 'Annulation impossible.' }, { status: 500 });
  }

  await offerNextInLine(order.eventId).catch((err) =>
    console.error("Échec de relance de la liste d'attente", err),
  );

  return NextResponse.json({ cancelled: true });
}
