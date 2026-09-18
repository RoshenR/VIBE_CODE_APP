import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { events, ticketTypes } from '@/db/schema';
import { slugify } from '@/lib/reference';
import { offerNextInLine } from './waitlist';

/**
 * Création et administration des événements.
 *
 * Toutes les fonctions prennent un `organizationId` et filtrent dessus : un
 * collectif ne peut ni lire ni modifier l'événement d'un autre.
 */

export class EventError extends Error {
  constructor(
    readonly code: 'not_found' | 'capacity_too_low' | 'has_orders' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'EventError';
  }
}

/** Alloue un slug unique, en suffixant si le titre est déjà pris. */
async function allocateSlug(title: string): Promise<string> {
  const base = slugify(title) || 'evenement';

  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [existing] = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.slug, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function createEvent(
  organizationId: string,
  input: {
    title: string;
    description: string;
    venueName?: string | null;
    venueAddress?: string | null;
    isOnline: boolean;
    onlineUrl?: string | null;
    timezone: string;
    startsAt: Date;
    doorsAt?: Date | null;
    holdMinutesCard: number;
    holdHoursTransfer: number;
    waitlistOfferHours: number;
    cancellationDeadlineHours: number;
  },
): Promise<string> {
  const [event] = await db
    .insert(events)
    .values({
      organizationId,
      slug: await allocateSlug(input.title),
      title: input.title,
      description: input.description,
      venueName: input.isOnline ? null : (input.venueName ?? null),
      venueAddress: input.isOnline ? null : (input.venueAddress ?? null),
      isOnline: input.isOnline,
      onlineUrl: input.isOnline ? (input.onlineUrl || null) : null,
      timezone: input.timezone,
      startsAt: input.startsAt,
      doorsAt: input.doorsAt ?? null,
      holdMinutesCard: input.holdMinutesCard,
      holdHoursTransfer: input.holdHoursTransfer,
      waitlistOfferHours: input.waitlistOfferHours,
      cancellationDeadlineHours: input.cancellationDeadlineHours,
      // Toujours en brouillon : on n'ouvre pas la vente d'un événement sans
      // catégories de places.
      status: 'draft',
    })
    .returning();

  return event.id;
}

export async function updateEventSettings(
  organizationId: string,
  eventId: string,
  input: Partial<{
    title: string;
    description: string;
    venueName: string | null;
    venueAddress: string | null;
    timezone: string;
    startsAt: Date;
    doorsAt: Date | null;
    holdMinutesCard: number;
    holdHoursTransfer: number;
    waitlistOfferHours: number;
    cancellationDeadlineHours: number;
  }>,
): Promise<void> {
  const updated = await db
    .update(events)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
    .returning({ id: events.id });

  if (updated.length === 0) throw new EventError('not_found', 'Événement introuvable.');
}

/**
 * Ouvre ou ferme la vente.
 *
 * Un événement sans catégorie de place ne peut pas être publié : ce serait une
 * page de vente sans rien à vendre.
 */
export async function setEventStatus(
  organizationId: string,
  eventId: string,
  status: 'draft' | 'published' | 'cancelled',
): Promise<void> {
  if (status === 'published') {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(ticketTypes)
      .where(eq(ticketTypes.eventId, eventId));

    if (Number(row?.n ?? 0) === 0) {
      throw new EventError(
        'invalid',
        'Ajoutez au moins une catégorie de place avant de mettre en vente.',
      );
    }
  }

  const updated = await db
    .update(events)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
    .returning({ id: events.id });

  if (updated.length === 0) throw new EventError('not_found', 'Événement introuvable.');

  // Une remise en vente peut rendre des places disponibles.
  if (status === 'published') await offerNextInLine(eventId).catch(() => undefined);
}

/* -------------------------------------------------------------------------- */
/* Catégories de places                                                       */
/* -------------------------------------------------------------------------- */

export async function createTicketType(
  organizationId: string,
  eventId: string,
  input: {
    name: string;
    description: string;
    priceCents: number;
    earlyPriceCents?: number | null;
    earlyEndsAt?: Date | null;
    quantityTotal: number;
    maxPerOrder: number;
  },
): Promise<void> {
  const [event] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
    .limit(1);

  if (!event) throw new EventError('not_found', 'Événement introuvable.');

  const [{ next }] = await db
    .select({ next: sql<number>`COALESCE(MAX(${ticketTypes.position}), -1) + 1` })
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, eventId));

  await db.insert(ticketTypes).values({
    eventId,
    name: input.name,
    description: input.description,
    priceCents: input.priceCents,
    // Un tarif early sans date de fin n'a pas de sens : les deux vont ensemble.
    earlyPriceCents: input.earlyEndsAt ? (input.earlyPriceCents ?? null) : null,
    earlyEndsAt: input.earlyPriceCents ? (input.earlyEndsAt ?? null) : null,
    quantityTotal: input.quantityTotal,
    maxPerOrder: input.maxPerOrder,
    position: Number(next),
  });
}

/**
 * Modifie une catégorie de place.
 *
 * La jauge ne peut jamais descendre sous le nombre de places déjà détenues :
 * ce serait créer une survente à la main, exactement ce que le reste du système
 * s'emploie à rendre impossible. Le contrôle est fait **dans l'UPDATE**, pas
 * avant, pour rester juste même si une vente a lieu au même instant.
 */
export async function updateTicketType(
  organizationId: string,
  eventId: string,
  ticketTypeId: string,
  input: {
    name: string;
    description: string;
    priceCents: number;
    earlyPriceCents?: number | null;
    earlyEndsAt?: Date | null;
    quantityTotal: number;
    maxPerOrder: number;
  },
): Promise<void> {
  const [event] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
    .limit(1);

  if (!event) throw new EventError('not_found', 'Événement introuvable.');

  const [before] = await db
    .select({ quantityTotal: ticketTypes.quantityTotal })
    .from(ticketTypes)
    .where(and(eq(ticketTypes.id, ticketTypeId), eq(ticketTypes.eventId, eventId)))
    .limit(1);

  if (!before) throw new EventError('not_found', 'Catégorie introuvable.');

  const updated = await db
    .update(ticketTypes)
    .set({
      name: input.name,
      description: input.description,
      priceCents: input.priceCents,
      earlyPriceCents: input.earlyEndsAt ? (input.earlyPriceCents ?? null) : null,
      earlyEndsAt: input.earlyPriceCents ? (input.earlyEndsAt ?? null) : null,
      quantityTotal: input.quantityTotal,
      maxPerOrder: input.maxPerOrder,
    })
    .where(
      and(
        eq(ticketTypes.id, ticketTypeId),
        eq(ticketTypes.eventId, eventId),
        // Le garde-fou : refuse toute jauge inférieure aux places déjà détenues.
        sql`${ticketTypes.quantityReserved} <= ${input.quantityTotal}`,
      ),
    )
    .returning({ id: ticketTypes.id });

  if (updated.length === 0) {
    const [current] = await db
      .select({ reserved: ticketTypes.quantityReserved })
      .from(ticketTypes)
      .where(eq(ticketTypes.id, ticketTypeId))
      .limit(1);

    throw new EventError(
      'capacity_too_low',
      `Impossible : ${current?.reserved ?? 0} place(s) sont déjà réservées ou vendues dans cette catégorie.`,
    );
  }

  // Jauge augmentée : des places viennent d'apparaître, la liste d'attente en
  // profite immédiatement.
  if (input.quantityTotal > before.quantityTotal) {
    await offerNextInLine(eventId).catch(() => undefined);
  }
}

/** Suppression, refusée dès qu'une place a été vendue ou réservée. */
export async function deleteTicketType(
  organizationId: string,
  eventId: string,
  ticketTypeId: string,
): Promise<void> {
  const [event] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
    .limit(1);

  if (!event) throw new EventError('not_found', 'Événement introuvable.');

  const deleted = await db
    .delete(ticketTypes)
    .where(
      and(
        eq(ticketTypes.id, ticketTypeId),
        eq(ticketTypes.eventId, eventId),
        eq(ticketTypes.quantityReserved, 0),
      ),
    )
    .returning({ id: ticketTypes.id });

  if (deleted.length === 0) {
    throw new EventError(
      'has_orders',
      'Cette catégorie a déjà des réservations : elle ne peut plus être supprimée. Réduisez sa jauge si besoin.',
    );
  }
}
