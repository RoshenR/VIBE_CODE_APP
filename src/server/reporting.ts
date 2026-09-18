import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { events, orderItems, orders, ticketTypes, tickets } from '@/db/schema';
import { countWaiting } from './waitlist';

/**
 * Chiffres en temps réel.
 *
 * Répond à « on ne sait jamais combien on a vendu, ni combien on a encaissé par
 * type de place ». Toutes les fonctions prennent un `organizationId` et filtrent
 * dessus : un collectif ne peut pas lire les chiffres d'un autre, même en
 * devinant un identifiant.
 */

export interface TicketTypeStats {
  id: string;
  name: string;
  priceCents: number;
  total: number;
  sold: number;
  held: number; // réservé mais pas encore payé
  available: number;
  revenueCents: number;
  fillRate: number; // 0 → 1
}

export interface EventStats {
  eventId: string;
  title: string;
  startsAt: Date;
  timezone: string;
  status: string;
  capacity: number;
  sold: number;
  held: number;
  available: number;
  revenueCents: number;
  pendingCents: number;
  fillRate: number;
  waitingListSize: number;
  checkedIn: number;
  byTicketType: TicketTypeStats[];
}

export async function getEventStats(
  organizationId: string,
  eventId: string,
): Promise<EventStats | null> {
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
    .limit(1);

  if (!event) return null;

  const types = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, eventId))
    .orderBy(ticketTypes.position);

  // Encaissé réel par catégorie : on somme les lignes des commandes payées, et
  // non quantité × prix courant — un tarif early vendu 12 € ne doit pas être
  // recompté à 18 € une fois la période terminée.
  const revenueRows = await db
    .select({
      ticketTypeId: orderItems.ticketTypeId,
      revenue: sql<number>`COALESCE(SUM(${orderItems.subtotalCents}), 0)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.eventId, eventId), eq(orders.status, 'paid')))
    .groupBy(orderItems.ticketTypeId);

  const pendingRows = await db
    .select({
      ticketTypeId: orderItems.ticketTypeId,
      pending: sql<number>`COALESCE(SUM(${orderItems.subtotalCents}), 0)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.eventId, eventId), eq(orders.status, 'pending')))
    .groupBy(orderItems.ticketTypeId);

  const revenueByType = new Map(revenueRows.map((r) => [r.ticketTypeId, Number(r.revenue)]));
  const pendingByType = new Map(pendingRows.map((r) => [r.ticketTypeId, Number(r.pending)]));

  const byTicketType: TicketTypeStats[] = types.map((t) => {
    const sold = t.quantitySold;
    const held = t.quantityReserved - t.quantitySold;
    return {
      id: t.id,
      name: t.name,
      priceCents: t.priceCents,
      total: t.quantityTotal,
      sold,
      held,
      available: t.quantityTotal - t.quantityReserved,
      revenueCents: revenueByType.get(t.id) ?? 0,
      fillRate: t.quantityTotal > 0 ? t.quantityReserved / t.quantityTotal : 0,
    };
  });

  const capacity = byTicketType.reduce((s, t) => s + t.total, 0);
  const sold = byTicketType.reduce((s, t) => s + t.sold, 0);
  const held = byTicketType.reduce((s, t) => s + t.held, 0);

  const [checkinRow] = await db
    .select({ n: sql<number>`count(${tickets.checkedInAt})::int` })
    .from(tickets)
    .where(and(eq(tickets.eventId, eventId), eq(tickets.status, 'valid')));

  return {
    eventId,
    title: event.title,
    startsAt: event.startsAt,
    timezone: event.timezone,
    status: event.status,
    capacity,
    sold,
    held,
    available: capacity - sold - held,
    revenueCents: byTicketType.reduce((s, t) => s + t.revenueCents, 0),
    pendingCents: [...pendingByType.values()].reduce((s, v) => s + v, 0),
    fillRate: capacity > 0 ? (sold + held) / capacity : 0,
    waitingListSize: await countWaiting(db, eventId),
    checkedIn: Number(checkinRow?.n ?? 0),
    byTicketType,
  };
}

/** Vue d'ensemble de la page d'accueil de l'admin. */
export async function getOrganizationOverview(organizationId: string) {
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      slug: events.slug,
      startsAt: events.startsAt,
      timezone: events.timezone,
      status: events.status,
      capacity: sql<number>`COALESCE(SUM(${ticketTypes.quantityTotal}), 0)::int`,
      sold: sql<number>`COALESCE(SUM(${ticketTypes.quantitySold}), 0)::int`,
      reserved: sql<number>`COALESCE(SUM(${ticketTypes.quantityReserved}), 0)::int`,
    })
    .from(events)
    .leftJoin(ticketTypes, eq(ticketTypes.eventId, events.id))
    .where(eq(events.organizationId, organizationId))
    .groupBy(events.id)
    .orderBy(desc(events.startsAt));

  const revenue = await db
    .select({
      eventId: orders.eventId,
      revenue: sql<number>`COALESCE(SUM(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(and(eq(orders.organizationId, organizationId), eq(orders.status, 'paid')))
    .groupBy(orders.eventId);

  const revenueByEvent = new Map(revenue.map((r) => [r.eventId, Number(r.revenue)]));

  return rows.map((r) => ({
    ...r,
    capacity: Number(r.capacity),
    sold: Number(r.sold),
    reserved: Number(r.reserved),
    revenueCents: revenueByEvent.get(r.id) ?? 0,
    fillRate: Number(r.capacity) > 0 ? Number(r.reserved) / Number(r.capacity) : 0,
  }));
}

/* -------------------------------------------------------------------------- */
/* Courbe des ventes                                                          */
/* -------------------------------------------------------------------------- */

export interface SalesPoint {
  day: string; // AAAA-MM-JJ
  tickets: number;
  revenueCents: number;
  cumulativeTickets: number;
}

/**
 * Ventes jour par jour depuis l'ouverture.
 *
 * Répond à une question que le tableau de bord ne traitait pas : « est-ce que ça
 * part bien ? ». Un total de 210 places vendues ne dit rien tout seul — 210 en
 * trois jours et 210 en six semaines n'appellent pas la même décision sur la
 * communication ou sur l'ouverture d'une seconde date.
 *
 * `generate_series` comble les jours sans vente : une courbe avec des trous
 * laisserait croire à une progression continue là où il ne s'est rien passé.
 */
export async function getSalesTimeline(
  organizationId: string,
  eventId: string,
): Promise<SalesPoint[]> {
  const [event] = await db
    .select({ id: events.id, timezone: events.timezone, createdAt: events.createdAt })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
    .limit(1);

  if (!event) return [];

  const result = await db.execute(sql`
    WITH bornes AS (
      SELECT
        LEAST(
          MIN(o.paid_at AT TIME ZONE ${event.timezone}),
          now() AT TIME ZONE ${event.timezone}
        )::date AS debut,
        (now() AT TIME ZONE ${event.timezone})::date AS fin
        FROM orders o
       WHERE o.event_id = ${eventId} AND o.status = 'paid'
    ),
    jours AS (
      SELECT generate_series(
               COALESCE((SELECT debut FROM bornes), (now() AT TIME ZONE ${event.timezone})::date),
               (SELECT fin FROM bornes),
               interval '1 day'
             )::date AS jour
    ),
    ventes AS (
      SELECT (o.paid_at AT TIME ZONE ${event.timezone})::date AS jour,
             SUM(oi.quantity)::int AS billets,
             SUM(oi.subtotal_cents)::int AS recette
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
       WHERE o.event_id = ${eventId} AND o.status = 'paid'
       GROUP BY 1
    )
    SELECT to_char(j.jour, 'YYYY-MM-DD') AS jour,
           COALESCE(v.billets, 0) AS billets,
           COALESCE(v.recette, 0) AS recette
      FROM jours j
      LEFT JOIN ventes v ON v.jour = j.jour
     ORDER BY j.jour
  `);

  const rows = (
    Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  ) as { jour: string; billets: number; recette: number }[];

  let cumulative = 0;
  return rows.map((r) => {
    cumulative += Number(r.billets);
    return {
      day: r.jour,
      tickets: Number(r.billets),
      revenueCents: Number(r.recette),
      cumulativeTickets: cumulative,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Export pour le lieu                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Liste des participants au format CSV, telle que les salles la réclament.
 *
 * Séparateur `;` et BOM UTF-8 : c'est ce qu'attend Excel en configuration
 * française. Sans le BOM, les accents ressortent en caractères parasites et le
 * régisseur renvoie le fichier.
 */
export async function exportAttendeesCsv(
  organizationId: string,
  eventId: string,
): Promise<string | null> {
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
    .limit(1);

  if (!event) return null;

  const rows = await db
    .select({
      serial: tickets.serial,
      holderName: tickets.holderName,
      ticketTypeName: ticketTypes.name,
      reference: orders.reference,
      email: orders.customerEmail,
      phone: orders.customerPhone,
      status: tickets.status,
      checkedInAt: tickets.checkedInAt,
    })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .where(and(eq(tickets.eventId, eventId), eq(orders.status, 'paid')))
    .orderBy(ticketTypes.position, tickets.serial);

  const header = [
    'Billet',
    'Nom',
    'Catégorie',
    'Référence commande',
    'E-mail',
    'Téléphone',
    'Statut',
    'Entré à',
  ];

  const lines = rows.map((r) =>
    [
      r.serial,
      r.holderName,
      r.ticketTypeName,
      r.reference,
      r.email,
      r.phone ?? '',
      r.status === 'valid' ? 'Valide' : 'Annulé',
      r.checkedInAt
        ? new Intl.DateTimeFormat('fr-FR', {
            timeZone: event.timezone,
            dateStyle: 'short',
            timeStyle: 'short',
          }).format(r.checkedInAt)
        : '',
    ]
      .map(csvCell)
      .join(';'),
  );

  return '﻿' + [header.map(csvCell).join(';'), ...lines].join('\r\n');
}

function csvCell(value: string): string {
  // Neutralise les formules : une cellule commençant par = ou + est exécutée par
  // Excel à l'ouverture.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
