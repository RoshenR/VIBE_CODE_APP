/**
 * Contrat que doit remplir un prestataire de paiement.
 *
 * Tout le reste de l'application ne connaît que cette interface. Passer du
 * simulateur à Stripe, HelloAsso ou SumUp consiste à écrire un second fichier
 * qui l'implémente et à changer PAYMENT_PROVIDER — aucun code métier ne bouge.
 */

export interface CheckoutRequest {
  orderId: string;
  reference: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  /** Identifiant de la session chez le prestataire. */
  providerRef: string;
  /** URL vers laquelle rediriger le client pour payer. */
  checkoutUrl: string;
}

/** Notification reçue du prestataire, une fois décodée. */
export interface ProviderEvent {
  /**
   * Identifiant unique et **stable** de la notification chez le prestataire.
   *
   * C'est la clé de l'idempotence : si le prestataire renvoie la même
   * notification, il doit renvoyer le même identifiant. Toute la protection
   * contre le double billet repose dessus.
   */
  id: string;
  type: 'payment_succeeded' | 'payment_failed' | 'payment_refunded' | 'unknown';
  /** Référence de la commande côté prestataire. */
  providerRef: string;
  orderId: string | null;
  amountCents: number | null;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: string;

  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;

  /**
   * Vérifie l'authenticité d'une notification entrante (signature HMAC).
   * Une notification non vérifiée ne doit jamais être traitée : n'importe qui
   * pourrait sinon se déclarer payé.
   */
  verifyWebhook(rawBody: string, headers: Headers): boolean;

  parseEvent(rawBody: string): ProviderEvent;
}
