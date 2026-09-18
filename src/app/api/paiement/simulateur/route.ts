import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { signPayload } from '@/server/payments';
import { guardOrigin } from '@/lib/api-auth';

/**
 * Déclenche une notification du prestataire factice.
 *
 * Elle est **réellement envoyée en HTTP** à `/api/webhooks/simulator`, signature
 * comprise : on éprouve le chemin complet de production, pas un raccourci de
 * test. C'est ce qui permet de vérifier pour de bon le comportement face à une
 * notification envoyée deux fois.
 */
export async function POST(request: Request) {
  // Double verrou : le simulateur n'existe ni hors du mode « simulator », ni en
  // production. Une billetterie réelle ne doit en aucun cas exposer une route
  // capable de déclarer un paiement reçu.
  if ((process.env.PAYMENT_PROVIDER ?? 'simulator') !== 'simulator') {
    return NextResponse.json({ error: 'Simulateur désactivé.' }, { status: 404 });
  }
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PAYMENT_SIMULATOR !== 'true') {
    return NextResponse.json({ error: 'Indisponible.' }, { status: 404 });
  }

  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  const body = (await request.json()) as {
    orderId?: string;
    providerRef?: string;
    outcome?: 'succeeded' | 'failed';
    /** Rejoue à l'identique la notification précédente (même identifiant). */
    replayEventId?: string;
  };

  if (!body.orderId) {
    return NextResponse.json({ error: 'Commande manquante.' }, { status: 400 });
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, body.orderId)).limit(1);
  if (!order) return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });

  const payload = JSON.stringify({
    // Rejouer = réutiliser le même identifiant, exactement comme le ferait un
    // prestataire qui renvoie sa notification.
    id: body.replayEventId ?? `evt_${randomUUID()}`,
    type: body.outcome === 'failed' ? 'payment_failed' : 'payment_succeeded',
    providerRef: body.providerRef ?? '',
    orderId: order.id,
    amountCents: order.totalCents,
  });

  const appUrl = process.env.APP_URL ?? new URL(request.url).origin;

  const response = await fetch(`${appUrl}/api/webhooks/simulator`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature': signPayload(payload),
    },
    body: payload,
  });

  const result = await response.json().catch(() => ({}));

  return NextResponse.json({
    eventId: JSON.parse(payload).id as string,
    manageToken: order.manageToken,
    webhookStatus: response.status,
    webhookResult: result,
  });
}
