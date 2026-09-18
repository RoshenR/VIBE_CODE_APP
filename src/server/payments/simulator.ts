import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  ProviderEvent,
} from './provider';

const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-a-changer-absolument';

/**
 * Prestataire de paiement factice pour le développement et la recette.
 *
 * Il reproduit fidèlement le comportement d'un vrai prestataire, y compris celui
 * qui pose problème au client : la page de simulation permet d'**envoyer la même
 * notification deux fois** afin de vérifier qu'un seul jeu de billets est émis.
 */
export class SimulatorProvider implements PaymentProvider {
  readonly name = 'simulator';

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const providerRef = `sim_${randomUUID()}`;
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const url = new URL('/paiement/simulateur', appUrl);
    url.searchParams.set('ref', providerRef);
    url.searchParams.set('order', request.orderId);
    return { providerRef, checkoutUrl: url.toString() };
  }

  verifyWebhook(rawBody: string, headers: Headers): boolean {
    const received = headers.get('x-signature');
    if (!received) return false;

    const expected = signPayload(rawBody);
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseEvent(rawBody: string): ProviderEvent {
    const data = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      providerRef?: string;
      orderId?: string;
      amountCents?: number;
    };

    const type: ProviderEvent['type'] =
      data.type === 'payment_succeeded' ||
      data.type === 'payment_failed' ||
      data.type === 'payment_refunded'
        ? data.type
        : 'unknown';

    return {
      id: data.id ?? '',
      type,
      providerRef: data.providerRef ?? '',
      orderId: data.orderId ?? null,
      amountCents: data.amountCents ?? null,
      raw: data,
    };
  }
}

/** Utilisé par la page de simulation pour signer ses notifications. */
export function signPayload(rawBody: string): string {
  return createHmac('sha256', SECRET).update(rawBody).digest('hex');
}
