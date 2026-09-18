import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import type { Executor } from '@/db';
import { events, ticketTypes, waitlistEntries } from '@/db/schema';
import { InsufficientStockError, releaseSeats, reserveSeats } from './inventory';
import { generateLinkToken } from '@/lib/reference';
import { enqueueEmail } from './outbox';

/**
 * Liste d'attente.
 *
 * Remplace la gestion manuelle sur Instagram, en conservant le principe que le
 * client appliquait déjà : **ordre d'arrivée strict**, et un délai laissé à
 * chacun pour répondre avant de passer au suivant.
 *
 * Différence essentielle avec la version manuelle : pendant qu'une offre est en
 * cours, les places sont **réellement détenues** en base. Personne d'autre ne peut
 * les acheter entre-temps, donc l'offre n'est jamais une promesse en l'air.
 */

export class WaitlistError extends Error {
  constructor(
    readonly code: 'not_found' | 'expired' | 'already_used' | 'event_closed',
    message: string,
  ) {
    super(message);
    this.name = 'WaitlistError';
  }
}

/* -------------------------------------------------------------------------- */
/* Inscription                                                                */
/* -------------------------------------------------------------------------- */

export async function joinWaitlist(input: {
  eventId: string;
  ticketTypeId?: string | null;
  name: string;
  email: string;
  quantity: number;
}): Promise<{ position: number; alreadyRegistered: boolean }> {
  const email = input.email.toLowerCase().trim();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ position: waitlistEntries.position })
      .from(waitlistEntries)
      .where(
        and(
          eq(waitlistEntries.eventId, input.eventId),
          eq(waitlistEntries.email, email),
          sql`${waitlistEntries.status} IN ('waiting', 'offered')`,
        ),
      )
      .limit(1);

    if (existing) return { position: existing.position, alreadyRegistered: true };

    // Le rang est calculé sous verrou d'insertion : deux inscriptions simultanées
    // ne peuvent pas obtenir le même numéro d'ordre.
    const [{ next }] = await tx
      .select({ next: sql<number>`COALESCE(MAX(${waitlistEntries.position}), 0) + 1` })
      .from(waitlistEntries)
      .where(eq(waitlistEntries.eventId, input.eventId));

    const position = Number(next);

    const unsubscribeToken = generateLinkToken();

    await tx.insert(waitlistEntries).values({
      eventId: input.eventId,
      ticketTypeId: input.ticketTypeId ?? null,
      name: input.name,
      email,
      quantity: input.quantity,
      position,
      status: 'waiting',
      unsubscribeToken,
    });

    await enqueueEmail(tx, {
      to: email,
      template: 'waitlist_registered',
      payload: { eventId: input.eventId, position, unsubscribeToken },
    });

    return { position, alreadyRegistered: false };
  });
}

/* -------------------------------------------------------------------------- */
/* Distribution des places libérées                                           */
/* -------------------------------------------------------------------------- */

/**
 * Propose les places disponibles aux premiers inscrits, dans l'ordre.
 *
 * Appelée dès qu'une place se libère : expiration d'une réservation, annulation
 * client, remboursement, ou augmentation de la jauge par l'équipe.
 *
 * @returns le nombre d'offres envoyées.
 */
export async function offerNextInLine(eventId: string): Promise<number> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event || event.status !== 'published') return 0;

  let offersSent = 0;

  // Une transaction par offre : si l'une échoue, les autres tiennent quand même.
  // La boucle s'arrête d'elle-même dès qu'il n'y a plus de place ou plus personne.
  for (let guard = 0; guard < 100; guard++) {
    const sent = await db.transaction(async (tx) => {
      const candidate = await nextEligibleEntry(tx, eventId);
      if (!candidate) return false;

      const { entry, ticketTypeId } = candidate;

      try {
        await reserveSeats(tx, [{ ticketTypeId, quantity: entry.quantity }]);
      } catch (err) {
        if (err instanceof InsufficientStockError) return false;
        throw err;
      }

      const offerToken = generateLinkToken();
      const offerExpiresAt = new Date(Date.now() + event.waitlistOfferHours * 3_600_000);

      await tx
        .update(waitlistEntries)
        .set({
          status: 'offered',
          ticketTypeId,
          offerToken,
          offeredAt: new Date(),
          offerExpiresAt,
        })
        .where(eq(waitlistEntries.id, entry.id));

      await enqueueEmail(tx, {
        to: entry.email,
        template: 'waitlist_offer',
        payload: {
          entryId: entry.id,
          eventId,
          offerToken,
          offerExpiresAt: offerExpiresAt.toISOString(),
          quantity: entry.quantity,
        },
      });

      return true;
    });

    if (!sent) break;
    offersSent++;
  }

  return offersSent;
}

/**
 * Premier inscrit de la file qui peut être servi avec le stock restant.
 *
 * Une personne qui demande 4 places alors qu'il n'en reste que 2 n'est **pas**
 * doublée : on s'arrête à elle et on attend qu'assez de places se libèrent. Sauter
 * son tour reviendrait à trahir l'ordre d'arrivée, qui est la seule promesse
 * faite aux gens.
 */
async function nextEligibleEntry(
  tx: Executor,
  eventId: string,
): Promise<{ entry: typeof waitlistEntries.$inferSelect; ticketTypeId: string } | null> {
  const [entry] = await tx
    .select()
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.eventId, eventId), eq(waitlistEntries.status, 'waiting')))
    .orderBy(asc(waitlistEntries.position))
    .limit(1);

  if (!entry) return null;

  const types = await tx
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, eventId))
    .orderBy(asc(ticketTypes.position));

  const candidates = entry.ticketTypeId
    ? types.filter((t) => t.id === entry.ticketTypeId)
    : types;

  const match = candidates.find(
    (t) => t.quantityTotal - t.quantityReserved >= entry.quantity,
  );

  return match ? { entry, ticketTypeId: match.id } : null;
}

/**
 * Expire les offres sans réponse et relance la file.
 *
 * C'est exactement le geste que l'équipe faisait à la main : « il n'a pas répondu,
 * je passe au suivant ».
 */
export async function expireStaleOffers(): Promise<number> {
  const stale = await db
    .select()
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.status, 'offered'),
        sql`${waitlistEntries.offerExpiresAt} < now()`,
      ),
    )
    .limit(200);

  const touchedEvents = new Set<string>();

  for (const entry of stale) {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(waitlistEntries)
        .set({ status: 'expired', offerToken: null })
        .where(and(eq(waitlistEntries.id, entry.id), eq(waitlistEntries.status, 'offered')))
        .returning();

      if (updated.length === 0) return; // acceptée entre-temps

      if (entry.ticketTypeId) {
        await releaseSeats(tx, [
          { ticketTypeId: entry.ticketTypeId, quantity: entry.quantity },
        ]);
      }

      await enqueueEmail(tx, {
        to: entry.email,
        template: 'waitlist_offer_expired',
        payload: { entryId: entry.id, eventId: entry.eventId },
      });
    });
    touchedEvents.add(entry.eventId);
  }

  for (const eventId of touchedEvents) {
    await offerNextInLine(eventId).catch(() => undefined);
  }

  return stale.length;
}

/* -------------------------------------------------------------------------- */
/* Acceptation d'une offre                                                    */
/* -------------------------------------------------------------------------- */

export interface OfferDetail {
  entry: typeof waitlistEntries.$inferSelect;
  event: typeof events.$inferSelect;
  ticketType: typeof ticketTypes.$inferSelect;
}

export async function getOffer(offerToken: string): Promise<OfferDetail> {
  const [entry] = await db
    .select()
    .from(waitlistEntries)
    .where(eq(waitlistEntries.offerToken, offerToken))
    .limit(1);

  if (!entry) throw new WaitlistError('not_found', 'Cette offre est introuvable.');
  if (entry.status === 'converted') {
    throw new WaitlistError('already_used', 'Cette offre a déjà été utilisée.');
  }
  if (entry.status !== 'offered') {
    throw new WaitlistError('expired', "Cette offre n'est plus valable.");
  }
  if (entry.offerExpiresAt && entry.offerExpiresAt < new Date()) {
    throw new WaitlistError('expired', 'Le délai de réponse est dépassé.');
  }

  const [event] = await db.select().from(events).where(eq(events.id, entry.eventId)).limit(1);
  const [ticketType] = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.id, entry.ticketTypeId ?? ''))
    .limit(1);

  if (!event || !ticketType) {
    throw new WaitlistError('not_found', 'Cette offre est introuvable.');
  }
  return { entry, event, ticketType };
}

/**
 * Marque une offre comme convertie.
 *
 * Le filtre sur `status = 'offered'` empêche deux ouvertures simultanées du même
 * lien de créer deux commandes. Les places étant déjà détenues depuis l'envoi de
 * l'offre, la commande est créée avec `seatsAlreadyHeld`.
 */
export async function consumeOffer(
  tx: Executor,
  entryId: string,
  orderId: string,
): Promise<boolean> {
  const updated = await tx
    .update(waitlistEntries)
    .set({ status: 'converted', offerToken: null, convertedOrderId: orderId })
    .where(and(eq(waitlistEntries.id, entryId), eq(waitlistEntries.status, 'offered')))
    .returning();

  return updated.length > 0;
}

/**
 * Désinscription volontaire.
 *
 * Indispensable : quelqu'un d'inscrit par erreur — ou qui a finalement trouvé sa
 * place ailleurs — doit pouvoir sortir de la file sans écrire à personne. Sans
 * ce lien, il continuerait de recevoir des offres, et surtout il occuperait un
 * rang devant des gens qui, eux, attendent vraiment.
 *
 * Si une offre était en cours, les places détenues repartent immédiatement au
 * suivant.
 */
export async function unsubscribe(
  token: string,
): Promise<{ ok: boolean; eventId: string | null }> {
  const result = await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.unsubscribeToken, token))
      .limit(1);

    if (!entry) return { ok: false, eventId: null, releasedSeats: false };
    if (entry.status === 'cancelled') {
      return { ok: true, eventId: entry.eventId, releasedSeats: false };
    }

    const hadOffer = entry.status === 'offered' && entry.ticketTypeId !== null;

    await tx
      .update(waitlistEntries)
      .set({ status: 'cancelled', offerToken: null })
      .where(eq(waitlistEntries.id, entry.id));

    if (hadOffer) {
      await releaseSeats(tx, [
        { ticketTypeId: entry.ticketTypeId!, quantity: entry.quantity },
      ]);
    }

    return { ok: true, eventId: entry.eventId, releasedSeats: hadOffer };
  });

  // Les places rendues sont proposées au suivant, une fois la transaction validée.
  if (result.releasedSeats && result.eventId) {
    await offerNextInLine(result.eventId).catch(() => undefined);
  }

  return { ok: result.ok, eventId: result.eventId };
}

export async function countWaiting(executor: Executor, eventId: string): Promise<number> {
  const [row] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.eventId, eventId),
        sql`${waitlistEntries.status} IN ('waiting', 'offered')`,
      ),
    );
  return Number(row?.n ?? 0);
}
