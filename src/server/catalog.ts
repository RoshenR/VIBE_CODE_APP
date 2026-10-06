import { and, asc, eq, gte } from 'drizzle-orm';
import { db } from '@/db';
import { events, organizations, ticketTypes } from '@/db/schema';
import { resolvePrice } from '@/lib/money';
import { computeSalesState, type SalesState } from '@/lib/programme';

/**
 * Façade publique : ce que voient les visiteurs.
 *
 * Contrairement à l'admin, elle n'est pas cloisonnée par collectif — les
 * collectifs partagent la même vitrine. Ce qui reste cloisonné, ce sont les
 * chiffres (voir reporting.ts).
 *
 * Tout ce qui est affiché ici vient de l'état réel : stocks, tarif early, fenêtres
 * de vente. L'interface ne fabrique ni urgence ni rareté.
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
  /** `soldout` | `ended` | `notStarted` quand la catégorie n'est pas achetable. */
  closedKind: 'soldout' | 'ended' | 'notStarted' | null;
  closedReason: string | null;
  salesStartAt: Date | null;
}

export interface PublicEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  organizationName: string;
  organizationSlug: string;
  isOnline: boolean;
  onlineUrl: string | null;
  venueName: string | null;
  venueAddress: string | null;
  timezone: string;
  doorsAt: Date | null;
  startsAt: Date;
  cancellationDeadlineHours: number;
  holdMinutesCard: number;
  holdHoursTransfer: number;
  waitlistOfferHours: number;
  ticketTypes: PublicTicketType[];
  /** Places achetables à cet instant, toutes catégories ouvertes confondues. */
  totalAvailable: number;
  salesState: SalesState;
  /** Première ouverture de vente à venir, si la vente n'a pas commencé. */
  opensAt: Date | null;
}

type EventRow = typeof events.$inferSelect;
type TypeRow = typeof ticketTypes.$inferSelect;

function summarize(event: EventRow, types: TypeRow[], now: Date) {
  const salesState = computeSalesState(types, now);

  const sellable = types.filter(
    (t) => !(t.salesEndAt && now > t.salesEndAt) && !(t.salesStartAt && now < t.salesStartAt),
  );
  const totalAvailable = sellable.reduce(
    (sum, t) => sum + Math.max(0, t.quantityTotal - t.quantityReserved),
    0,
  );

  const upcomingStarts = types
    .map((t) => t.salesStartAt)
    .filter((d): d is Date => d !== null && d > now)
    .sort((a, b) => a.getTime() - b.getTime());

  return {
    salesState,
    totalAvailable,
    opensAt: salesState === 'upcoming' ? (upcomingStarts[0] ?? null) : null,
    holdMinutesCard: event.holdMinutesCard,
    holdHoursTransfer: event.holdHoursTransfer,
    waitlistOfferHours: event.waitlistOfferHours,
  };
}

export type PublicEventSummary = Omit<PublicEvent, 'ticketTypes'> & {
  fromPriceCents: number | null;
};

/**
 * Événements publiés à venir, du plus proche au plus lointain.
 *
 * Les concerts passés ne sont pas listés : la programmation est ce qui reste à
 * vivre.
 */
export async function listPublishedEvents(): Promise<PublicEventSummary[]> {
  const rows = await db
    .select({
      event: events,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
    })
    .from(events)
    .innerJoin(organizations, eq(organizations.id, events.organizationId))
    .where(and(eq(events.status, 'published'), gte(events.startsAt, new Date())))
    .orderBy(asc(events.startsAt));

  const now = new Date();
  const result: PublicEventSummary[] = [];

  for (const { event, organizationName, organizationSlug } of rows) {
    const types = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.eventId, event.id))
      .orderBy(asc(ticketTypes.position));

    const prices = types.map((t) => resolvePrice(t, now).cents);

    result.push({
      id: event.id,
      slug: event.slug,
      title: event.title,
      description: event.description,
      organizationName,
      organizationSlug,
      isOnline: event.isOnline,
      onlineUrl: null, // jamais exposé avant l'achat
      venueName: event.venueName,
      venueAddress: event.venueAddress,
      timezone: event.timezone,
      doorsAt: event.doorsAt,
      startsAt: event.startsAt,
      cancellationDeadlineHours: event.cancellationDeadlineHours,
      fromPriceCents: prices.length > 0 ? Math.min(...prices) : null,
      ...summarize(event, types, now),
    });
  }

  return result;
}

export async function getPublicEvent(slug: string): Promise<PublicEvent | null> {
  const [row] = await db
    .select({
      event: events,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
    })
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
    const available = Math.max(0, t.quantityTotal - t.quantityReserved);

    let closedKind: PublicTicketType['closedKind'] = null;
    let closedReason: string | null = null;
    if (t.salesStartAt && now < t.salesStartAt) {
      closedKind = 'notStarted';
      closedReason = 'Vente pas encore ouverte';
    } else if (t.salesEndAt && now > t.salesEndAt) {
      closedKind = 'ended';
      closedReason = 'Vente terminée';
    } else if (available <= 0) {
      closedKind = 'soldout';
      closedReason = 'Complet';
    }

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
      maxPerOrder: Math.min(t.maxPerOrder, available),
      onSale: closedKind === null,
      closedKind,
      closedReason,
      salesStartAt: t.salesStartAt,
    };
  });

  return {
    id: row.event.id,
    slug: row.event.slug,
    title: row.event.title,
    description: row.event.description,
    organizationName: row.organizationName,
    organizationSlug: row.organizationSlug,
    isOnline: row.event.isOnline,
    onlineUrl: null,
    venueName: row.event.venueName,
    venueAddress: row.event.venueAddress,
    timezone: row.event.timezone,
    doorsAt: row.event.doorsAt,
    startsAt: row.event.startsAt,
    cancellationDeadlineHours: row.event.cancellationDeadlineHours,
    ticketTypes: publicTypes,
    ...summarize(row.event, types, now),
  };
}
