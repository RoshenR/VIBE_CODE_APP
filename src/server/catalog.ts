import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { events, organizations, ticketTypes } from '@/db/schema';
import { resolvePrice } from '@/lib/money';

/**
 * Façade publique : ce que voient les visiteurs.
 *
 * Contrairement à l'admin, elle n'est pas cloisonnée par collectif — les trois
 * collectifs partagent la même vitrine. Ce qui reste cloisonné, ce sont les
 * chiffres (voir reporting.ts).
 */

export interface PublicTicketType {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  isEarly: boolean;
  earlyEndsAt: Date | null;
  standardPriceCents: number;
  available: number;
  maxPerOrder: number;
  onSale: boolean;
  closedReason: string | null;
}

export interface PublicEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  organizationName: string;
  isOnline: boolean;
  onlineUrl: string | null;
  venueName: string | null;
  venueAddress: string | null;
  timezone: string;
  doorsAt: Date | null;
  startsAt: Date;
  cancellationDeadlineHours: number;
  ticketTypes: PublicTicketType[];
  totalAvailable: number;
  soldOut: boolean;
}

export async function listPublishedEvents(): Promise<
  (Omit<PublicEvent, 'ticketTypes'> & { fromPriceCents: number | null })[]
> {
  const rows = await db
    .select({
      event: events,
      organizationName: organizations.name,
    })
    .from(events)
    .innerJoin(organizations, eq(organizations.id, events.organizationId))
    .where(and(eq(events.status, 'published'), gte(events.startsAt, new Date())))
    .orderBy(asc(events.startsAt));

  const now = new Date();
  const result = [];

  for (const { event, organizationName } of rows) {
    const types = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.eventId, event.id))
      .orderBy(asc(ticketTypes.position));

    const totalAvailable = types.reduce(
      (sum, t) => sum + (t.quantityTotal - t.quantityReserved),
      0,
    );
    const prices = types.map((t) => resolvePrice(t, now).cents);

    result.push({
      id: event.id,
      slug: event.slug,
      title: event.title,
      description: event.description,
      organizationName,
      isOnline: event.isOnline,
      onlineUrl: null, // jamais exposé avant l'achat
      venueName: event.venueName,
      venueAddress: event.venueAddress,
      timezone: event.timezone,
      doorsAt: event.doorsAt,
      startsAt: event.startsAt,
      cancellationDeadlineHours: event.cancellationDeadlineHours,
      totalAvailable,
      soldOut: totalAvailable <= 0,
      fromPriceCents: prices.length > 0 ? Math.min(...prices) : null,
    });
  }

  return result;
}

export async function getPublicEvent(slug: string): Promise<PublicEvent | null> {
  const [row] = await db
    .select({ event: events, organizationName: organizations.name })
    .from(events)
    .innerJoin(organizations, eq(organizations.id, events.organizationId))
    .where(eq(events.slug, slug))
    .limit(1);

  if (!row || row.event.status !== 'published') return null;

  const now = new Date();
  const types = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, row.event.id))
    .orderBy(asc(ticketTypes.position));

  const publicTypes: PublicTicketType[] = types.map((t) => {
    const price = resolvePrice(t, now);
    const available = t.quantityTotal - t.quantityReserved;

    let closedReason: string | null = null;
    if (t.salesStartAt && now < t.salesStartAt) closedReason = 'Vente pas encore ouverte';
    else if (t.salesEndAt && now > t.salesEndAt) closedReason = 'Vente terminée';
    else if (available <= 0) closedReason = 'Complet';

    return {
      id: t.id,
      name: t.name,
      description: t.description,
      priceCents: price.cents,
      currency: t.currency,
      isEarly: price.label === 'early',
      earlyEndsAt: t.earlyEndsAt,
      standardPriceCents: t.priceCents,
      available,
      maxPerOrder: Math.min(t.maxPerOrder, Math.max(available, 0)),
      onSale: closedReason === null,
      closedReason,
    };
  });

  const totalAvailable = publicTypes.reduce((s, t) => s + Math.max(t.available, 0), 0);

  return {
    id: row.event.id,
    slug: row.event.slug,
    title: row.event.title,
    description: row.event.description,
    organizationName: row.organizationName,
    isOnline: row.event.isOnline,
    onlineUrl: null,
    venueName: row.event.venueName,
    venueAddress: row.event.venueAddress,
    timezone: row.event.timezone,
    doorsAt: row.event.doorsAt,
    startsAt: row.event.startsAt,
    cancellationDeadlineHours: row.event.cancellationDeadlineHours,
    ticketTypes: publicTypes,
    totalAvailable,
    soldOut: totalAvailable <= 0,
  };
}
