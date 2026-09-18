import { emailOutbox } from '@/db/schema';
import type { Executor } from '@/db';

export type EmailTemplate =
  | 'order_pending'
  | 'order_confirmed'
  | 'order_reminder'
  | 'order_expired'
  | 'order_cancelled'
  | 'event_cancelled'
  | 'waitlist_registered'
  | 'waitlist_offer'
  | 'waitlist_offer_expired';

/**
 * Dépose un e-mail dans la file d'envoi.
 *
 * À appeler **dans la même transaction** que l'action métier : soit la commande
 * est confirmée et l'e-mail part, soit rien ne se passe. Un envoi direct depuis
 * la requête HTTP pourrait échouer après la confirmation et laisser un client
 * payé sans billet, sans trace.
 */
export async function enqueueEmail(
  tx: Executor,
  params: {
    to: string;
    template: EmailTemplate;
    payload: Record<string, unknown>;
    availableAt?: Date;
  },
): Promise<void> {
  await tx.insert(emailOutbox).values({
    toEmail: params.to,
    template: params.template,
    payload: params.payload,
    availableAt: params.availableAt ?? new Date(),
  });
}
