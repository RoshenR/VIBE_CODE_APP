import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders, paymentEvents, paymentIntents } from '@/db/schema';
import { confirmOrder, reclaimExpiredOrder, cancelOrder } from '../orders';
import { offerNextInLine } from '../waitlist';
import { SimulatorProvider } from './simulator';
import type { PaymentProvider, ProviderEvent } from './provider';

export type { PaymentProvider, ProviderEvent, CheckoutRequest } from './provider';
export { signPayload } from './simulator';

let cached: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  switch (process.env.PAYMENT_PROVIDER ?? 'simulator') {
    case 'simulator':
      cached = new SimulatorProvider();
      break;
    default:
      // Un prestataire inconnu doit faire échouer le démarrage, pas encaisser
      // silencieusement dans le vide.
      throw new Error(
        `Prestataire de paiement inconnu : ${process.env.PAYMENT_PROVIDER}. ` +
          `Ajoutez son implémentation dans src/server/payments/.`,
      );
  }
  return cached;
}

/** Ouvre une session de paiement et mémorise la référence du prestataire. */
export async function startCheckout(params: {
  orderId: string;
  reference: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  description: string;
}): Promise<{ checkoutUrl: string }> {
  const provider = getPaymentProvider();
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  const session = await provider.createCheckout({
    ...params,
    successUrl: `${appUrl}/commande/confirmation?order=${params.orderId}`,
    cancelUrl: `${appUrl}/commande/${params.orderId}`,
  });

  await db.insert(paymentIntents).values({
    orderId: params.orderId,
    provider: provider.name,
    providerRef: session.providerRef,
    amountCents: params.amountCents,
    currency: params.currency,
    status: 'created',
    checkoutUrl: session.checkoutUrl,
  });

  return { checkoutUrl: session.checkoutUrl };
}

export type WebhookOutcome =
  | { status: 'processed'; orderId: string | null }
  | { status: 'duplicate'; orderId: string | null }
  | { status: 'ignored'; reason: string }
  | { status: 'needs_refund'; orderId: string };

/**
 * Traite une notification du prestataire de paiement.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ DEUX BARRIÈRES contre la notification envoyée deux fois — le bug qui a     │
 * │ produit deux billets pour un seul paiement, et une personne venue avec un  │
 * │ ami :                                                                     │
 * │                                                                           │
 * │  1. `payment_events.provider_event_id` est UNIQUE. La seconde insertion    │
 * │     échoue ; on répond 200 sans rien faire. Le prestataire cesse de        │
 * │     réessayer.                                                            │
 * │                                                                           │
 * │  2. La confirmation elle-même est conditionnée à `status = 'pending'`      │
 * │     (voir confirmOrder). Même si la barrière 1 était contournée — deux     │
 * │     identifiants différents pour le même paiement — aucun second billet    │
 * │     ne serait émis.                                                       │
 * │                                                                           │
 * │ L'enregistrement de la notification et la confirmation sont dans LA MÊME   │
 * │ transaction : impossible d'enregistrer sans confirmer, ou l'inverse.       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export async function handleWebhookEvent(event: ProviderEvent): Promise<WebhookOutcome> {
  const provider = getPaymentProvider();

  if (!event.id) {
    return { status: 'ignored', reason: 'identifiant de notification absent' };
  }
  if (event.type === 'unknown') {
    return { status: 'ignored', reason: `type non géré` };
  }

  const result = await db.transaction(async (tx) => {
    // Barrière 1 : l'unicité fait foi.
    const inserted = await tx
      .insert(paymentEvents)
      .values({
        provider: provider.name,
        providerEventId: event.id,
        type: event.type,
        orderId: event.orderId,
        payload: event.raw as Record<string, unknown>,
      })
      .onConflictDoNothing({
        target: [paymentEvents.provider, paymentEvents.providerEventId],
      })
      .returning();

    if (inserted.length === 0) {
      return { status: 'duplicate', orderId: event.orderId } as WebhookOutcome;
    }

    const orderId = await resolveOrderId(tx, event);
    if (!orderId) {
      return { status: 'ignored', reason: 'commande introuvable' } as WebhookOutcome;
    }

    if (event.type === 'payment_succeeded') {
      // Barrière 2 : conditionnée à l'état `pending`.
      const confirmed = await confirmOrder(tx, orderId, { source: 'webhook' });

      if (!confirmed) {
        // Soit déjà payée (rejeu), soit expirée entre-temps (virement tardif).
        const [current] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);

        if (current?.status === 'expired') {
          const recovery = await reclaimExpiredOrder(tx, orderId);
          if (!recovery.recovered) {
            return { status: 'needs_refund', orderId } as WebhookOutcome;
          }
        }
      }

      await tx
        .update(paymentIntents)
        .set({ status: 'succeeded' })
        .where(eq(paymentIntents.providerRef, event.providerRef));
    }

    if (event.type === 'payment_refunded') {
      await cancelOrder(tx, orderId, 'organizer');
    }

    if (event.type === 'payment_failed') {
      await tx
        .update(paymentIntents)
        .set({ status: 'failed' })
        .where(eq(paymentIntents.providerRef, event.providerRef));
    }

    await tx
      .update(paymentEvents)
      .set({ processedAt: new Date(), orderId })
      .where(eq(paymentEvents.id, inserted[0].id));

    return { status: 'processed', orderId } as WebhookOutcome;
  });

  // Un remboursement libère des places : on prévient la liste d'attente une fois
  // la transaction validée, jamais avant.
  if (result.status === 'processed' && event.type === 'payment_refunded') {
    const [order] = await db
      .select({ eventId: orders.eventId })
      .from(orders)
      .where(eq(orders.id, result.orderId ?? ''))
      .limit(1);
    if (order) await offerNextInLine(order.eventId).catch(() => undefined);
  }

  return result;
}

async function resolveOrderId(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  event: ProviderEvent,
): Promise<string | null> {
  if (event.orderId) return event.orderId;

  const [intent] = await tx
    .select({ orderId: paymentIntents.orderId })
    .from(paymentIntents)
    .where(eq(paymentIntents.providerRef, event.providerRef))
    .limit(1);

  return intent?.orderId ?? null;
}
