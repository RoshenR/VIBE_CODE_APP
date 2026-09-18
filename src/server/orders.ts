import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import type { Executor } from '@/db';
import {
  events,
  orderItems,
  orders,
  ticketTypes,
  tickets,
  type Event,
  type Order,
  type TicketType,
} from '@/db/schema';
import {
  InsufficientStockError,
  markSeatsSold,
  releaseSeats,
  releaseSoldSeats,
  reserveSeats,
  type SeatRequest,
} from './inventory';
import { resolvePrice } from '@/lib/money';
import {
  buildTicketSerial,
  generateLinkToken,
  generateOrderReference,
} from '@/lib/reference';
import { enqueueEmail } from './outbox';

/* -------------------------------------------------------------------------- */
/* Erreurs métier                                                             */
/* -------------------------------------------------------------------------- */

export class OrderError extends Error {
  constructor(
    readonly code:
      | 'event_not_found'
      | 'event_not_on_sale'
      | 'empty_cart'
      | 'sales_closed'
      | 'too_many_per_order'
      | 'sold_out'
      | 'not_found'
      | 'not_cancellable'
      | 'deadline_passed'
      | 'email_quota',
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'OrderError';
  }
}

/* -------------------------------------------------------------------------- */
/* Durée de rétention                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Combien de temps une réservation non payée retient-elle ses places ?
 *
 * Le débat interne du client — « dix minutes » contre « trop court pour un
 * virement » — se tranche par le moyen de paiement, pas par un chiffre unique :
 *
 *   • carte     → quelques minutes suffisent, le paiement est immédiat ;
 *   • virement  → plusieurs jours, le temps que l'ordre soit exécuté.
 *
 * Les deux valeurs sont réglables par événement depuis l'admin.
 */
export function computeHoldExpiry(
  event: Pick<Event, 'holdMinutesCard' | 'holdHoursTransfer'>,
  method: 'card' | 'transfer' | 'free',
  now: Date = new Date(),
): Date | null {
  if (method === 'free') return null;
  const ms =
    method === 'transfer'
      ? event.holdHoursTransfer * 3_600_000
      : event.holdMinutesCard * 60_000;
  return new Date(now.getTime() + ms);
}

/* -------------------------------------------------------------------------- */
/* Création d'une réservation                                                 */
/* -------------------------------------------------------------------------- */

export interface CartLine {
  ticketTypeId: string;
  quantity: number;
}

export interface CreateHoldInput {
  eventSlug?: string;
  eventId?: string;
  lines: CartLine[];
  customer: {
    name: string;
    email: string;
    phone?: string | null;
    timezone?: string | null;
  };
  paymentMethod: 'card' | 'transfer';
  /** Renseigné quand la commande découle d'une offre de liste d'attente. */
  waitlistEntryId?: string;
  /** Les places ont déjà été détenues en amont (offre de liste d'attente). */
  seatsAlreadyHeld?: boolean;
}

export interface CreateHoldResult {
  order: Order;
  event: Event;
  holdExpiresAt: Date | null;
}

/**
 * Crée une réservation et détient les places, le tout en une transaction.
 *
 * Si une seule catégorie manque de stock, toute la transaction est annulée : les
 * places déjà prises pour les autres catégories de la commande sont relâchées
 * automatiquement par PostgreSQL. Aucune place ne peut rester « coincée ».
 */
export async function createHold(input: CreateHoldInput): Promise<CreateHoldResult> {
  const now = new Date();

  if (input.lines.length === 0) {
    throw new OrderError('empty_cart', 'Aucune place sélectionnée.');
  }

  return db.transaction(async (tx) => {
    const event = await loadEvent(tx, input);
    if (event.status !== 'published') {
      throw new OrderError('event_not_on_sale', "Cet événement n'est pas en vente.");
    }

    const typeIds = input.lines.map((l) => l.ticketTypeId);
    const types = await tx
      .select()
      .from(ticketTypes)
      .where(and(eq(ticketTypes.eventId, event.id), inArray(ticketTypes.id, typeIds)));

    const byId = new Map(types.map((t) => [t.id, t]));

    let totalCents = 0;
    const itemRows: {
      ticketTypeId: string;
      quantity: number;
      unitPriceCents: number;
      subtotalCents: number;
      appliedPrice: 'standard' | 'early';
    }[] = [];

    for (const line of input.lines) {
      const type = byId.get(line.ticketTypeId);
      if (!type) {
        throw new OrderError('event_not_found', 'Catégorie de place inconnue.');
      }
      assertOnSale(type, now);

      if (line.quantity < 1 || line.quantity > type.maxPerOrder) {
        throw new OrderError(
          'too_many_per_order',
          `Maximum ${type.maxPerOrder} place(s) par commande pour « ${type.name} ».`,
          { ticketTypeId: type.id, max: type.maxPerOrder },
        );
      }

      // Le prix est recalculé côté serveur : ce que le navigateur a affiché
      // n'engage à rien, notamment au moment où un tarif early bascule.
      const price = resolvePrice(type, now);
      const subtotal = price.cents * line.quantity;
      totalCents += subtotal;

      itemRows.push({
        ticketTypeId: type.id,
        quantity: line.quantity,
        unitPriceCents: price.cents,
        subtotalCents: subtotal,
        appliedPrice: price.label,
      });
    }

    await assertEmailQuota(
      tx,
      event,
      input.customer.email,
      itemRows.reduce((sum, i) => sum + i.quantity, 0),
    );

    const seats: SeatRequest[] = itemRows.map((i) => ({
      ticketTypeId: i.ticketTypeId,
      quantity: i.quantity,
    }));

    if (!input.seatsAlreadyHeld) {
      try {
        await reserveSeats(tx, seats);
      } catch (err) {
        if (err instanceof InsufficientStockError) {
          const type = byId.get(err.ticketTypeId);
          throw new OrderError(
            'sold_out',
            type
              ? `Il ne reste que ${err.available} place(s) en « ${type.name} ».`
              : err.message,
            { ticketTypeId: err.ticketTypeId, available: err.available },
          );
        }
        throw err;
      }
    }

    const method = totalCents === 0 ? 'free' : input.paymentMethod;
    const holdExpiresAt = computeHoldExpiry(event, method, now);
    const reference = await allocateReference(tx);

    const [order] = await tx
      .insert(orders)
      .values({
        organizationId: event.organizationId,
        eventId: event.id,
        reference,
        customerName: input.customer.name,
        customerEmail: input.customer.email.toLowerCase().trim(),
        customerPhone: input.customer.phone ?? null,
        customerTimezone: input.customer.timezone ?? null,
        status: 'pending',
        paymentMethod: method,
        totalCents,
        holdExpiresAt,
        manageToken: generateLinkToken(),
      })
      .returning();

    await tx.insert(orderItems).values(itemRows.map((i) => ({ ...i, orderId: order.id })));

    // Les places gratuites n'ont rien à payer : la commande est confirmée
    // immédiatement, billets compris.
    if (method === 'free') {
      const confirmed = await confirmOrder(tx, order.id, { source: 'free' });
      return { order: confirmed ?? order, event, holdExpiresAt: null };
    }

    await enqueueEmail(tx, {
      to: order.customerEmail,
      template: 'order_pending',
      payload: { orderId: order.id },
    });

    return { order, event, holdExpiresAt };
  });
}

/**
 * Plafond de places par adresse e-mail sur un même événement.
 *
 * `maxPerOrder` borne un panier ; sans ce second contrôle, il suffit de
 * repasser commande. Le décompte porte sur les commandes **en cours et payées**
 * — une commande expirée ou annulée ne doit évidemment pas pénaliser quelqu'un
 * qui revient acheter pour de bon.
 *
 * Le contrôle vit dans la transaction de réservation : deux commandes
 * simultanées depuis la même adresse ne peuvent pas passer toutes les deux en
 * lisant le même total.
 */
async function assertEmailQuota(
  tx: Executor,
  event: Event,
  email: string,
  requested: number,
): Promise<void> {
  const normalized = email.toLowerCase().trim();

  const [row] = await tx
    .select({ total: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orders.eventId, event.id),
        eq(orders.customerEmail, normalized),
        sql`${orders.status} IN ('pending', 'paid')`,
      ),
    );

  const already = Number(row?.total ?? 0);

  if (already + requested > event.maxTicketsPerEmail) {
    const remaining = Math.max(0, event.maxTicketsPerEmail - already);
    throw new OrderError(
      'email_quota',
      remaining === 0
        ? `Vous avez atteint la limite de ${event.maxTicketsPerEmail} places pour cet événement.`
        : `Limite de ${event.maxTicketsPerEmail} places par personne pour cet événement : il vous en reste ${remaining}.`,
      { limit: event.maxTicketsPerEmail, already, remaining },
    );
  }
}

function assertOnSale(type: TicketType, now: Date): void {
  if (type.salesStartAt && now < type.salesStartAt) {
    throw new OrderError(
      'sales_closed',
      `La vente pour « ${type.name} » n'a pas encore commencé.`,
    );
  }
  if (type.salesEndAt && now > type.salesEndAt) {
    throw new OrderError('sales_closed', `La vente pour « ${type.name} » est terminée.`);
  }
}

async function loadEvent(tx: Executor, input: CreateHoldInput): Promise<Event> {
  const where = input.eventId
    ? eq(events.id, input.eventId)
    : eq(events.slug, input.eventSlug ?? '');
  const [event] = await tx.select().from(events).where(where).limit(1);
  if (!event) throw new OrderError('event_not_found', 'Événement introuvable.');
  return event;
}

/**
 * Tire une référence de commande libre.
 *
 * L'index unique sur `orders.reference` reste l'autorité ; cette boucle évite
 * simplement de faire échouer une commande sur une collision improbable.
 */
async function allocateReference(tx: Executor): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = generateOrderReference();
    const [existing] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.reference, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  throw new Error("Impossible d'allouer une référence de commande.");
}

/* -------------------------------------------------------------------------- */
/* Confirmation du paiement                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Confirme une commande et émet ses billets.
 *
 * **Idempotente.** Le passage `pending → paid` se fait par un UPDATE conditionnel :
 * si zéro ligne est modifiée, c'est que la commande était déjà payée (ou expirée)
 * et aucun billet supplémentaire n'est créé. C'est la deuxième barrière contre la
 * notification de paiement envoyée deux fois, la première étant l'unicité de
 * l'identifiant d'événement du prestataire (voir payments/).
 *
 * @returns la commande confirmée, ou `null` si elle l'était déjà.
 */
export async function confirmOrder(
  tx: Executor,
  orderId: string,
  opts: { source: string; paidAt?: Date } = { source: 'webhook' },
): Promise<Order | null> {
  const paidAt = opts.paidAt ?? new Date();

  const updated = await tx
    .update(orders)
    .set({ status: 'paid', paidAt, holdExpiresAt: null })
    .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
    .returning();

  if (updated.length === 0) return null; // déjà traitée : on ne refait rien.

  const order = updated[0];
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));

  await markSeatsSold(
    tx,
    items.map((i) => ({ ticketTypeId: i.ticketTypeId, quantity: i.quantity })),
  );

  // Un billet nominatif par place.
  const rows: (typeof tickets.$inferInsert)[] = [];
  let index = 1;
  for (const item of items) {
    for (let n = 0; n < item.quantity; n++) {
      rows.push({
        orderId: order.id,
        eventId: order.eventId,
        ticketTypeId: item.ticketTypeId,
        serial: buildTicketSerial(order.reference, index++),
        holderName: order.customerName,
      });
    }
  }
  if (rows.length > 0) await tx.insert(tickets).values(rows);

  await enqueueEmail(tx, {
    to: order.customerEmail,
    template: 'order_confirmed',
    payload: { orderId: order.id, source: opts.source },
  });

  return order;
}

/**
 * Paiement arrivé après l'expiration de la réservation.
 *
 * Cas réel et fréquent avec les virements : le client paie, mais ses places ont
 * déjà été relâchées. On tente de les reprendre ; si elles sont parties, la
 * commande reste expirée et l'équipe est prévenue pour rembourser. Encaisser sans
 * pouvoir livrer serait pire que de traiter le cas explicitement.
 */
export async function reclaimExpiredOrder(
  tx: Executor,
  orderId: string,
): Promise<{ recovered: boolean; order: Order | null }> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return { recovered: false, order: null };
  if (order.status !== 'expired') return { recovered: false, order };

  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const seats = items.map((i) => ({ ticketTypeId: i.ticketTypeId, quantity: i.quantity }));

  try {
    await reserveSeats(tx, seats);
  } catch (err) {
    if (err instanceof InsufficientStockError) return { recovered: false, order };
    throw err;
  }

  await tx.update(orders).set({ status: 'pending' }).where(eq(orders.id, order.id));
  const confirmed = await confirmOrder(tx, order.id, { source: 'late_payment' });
  return { recovered: true, order: confirmed };
}

/* -------------------------------------------------------------------------- */
/* Expiration et annulation                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Fait expirer une réservation non payée et relâche ses places.
 *
 * Le filtre `status = 'pending'` dans l'UPDATE rend l'opération sûre même si le
 * worker et un paiement arrivent au même instant : un seul des deux l'emporte.
 */
export async function expireOrder(tx: Executor, orderId: string): Promise<boolean> {
  const updated = await tx
    .update(orders)
    .set({ status: 'expired', holdExpiresAt: null })
    .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
    .returning();

  if (updated.length === 0) return false;

  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  await releaseSeats(
    tx,
    items.map((i) => ({ ticketTypeId: i.ticketTypeId, quantity: i.quantity })),
  );

  await enqueueEmail(tx, {
    to: updated[0].customerEmail,
    template: 'order_expired',
    payload: { orderId },
  });

  return true;
}

export interface CancelResult {
  order: Order;
  releasedSeats: SeatRequest[];
}

/**
 * Annulation, qu'elle vienne du client (lien reçu par e-mail) ou de l'équipe.
 *
 * Les places retournent au stock et déclenchent la liste d'attente ; c'est
 * l'appelant qui enchaîne, pour que l'offre parte après validation de la
 * transaction.
 */
export async function cancelOrder(
  tx: Executor,
  orderId: string,
  by: 'customer' | 'organizer' | 'system',
  opts: { enforceDeadline?: boolean } = {},
): Promise<CancelResult> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) throw new OrderError('not_found', 'Commande introuvable.');

  if (order.status === 'cancelled' || order.status === 'refunded') {
    return { order, releasedSeats: [] }; // idempotent
  }
  if (order.status === 'expired') {
    throw new OrderError('not_cancellable', 'Cette réservation a déjà expiré.');
  }

  if (opts.enforceDeadline) {
    const [event] = await tx.select().from(events).where(eq(events.id, order.eventId)).limit(1);
    if (event) {
      const deadline = new Date(
        event.startsAt.getTime() - event.cancellationDeadlineHours * 3_600_000,
      );
      if (new Date() > deadline) {
        throw new OrderError(
          'deadline_passed',
          `L'annulation en ligne n'est plus possible moins de ${event.cancellationDeadlineHours} h avant le début.`,
          { deadline },
        );
      }
    }
  }

  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const seats = items.map((i) => ({ ticketTypeId: i.ticketTypeId, quantity: i.quantity }));

  const wasPaid = order.status === 'paid';
  if (wasPaid) {
    await releaseSoldSeats(tx, seats);
  } else {
    await releaseSeats(tx, seats);
  }

  await tx
    .update(tickets)
    .set({ status: wasPaid ? 'refunded' : 'cancelled' })
    .where(eq(tickets.orderId, orderId));

  const [cancelled] = await tx
    .update(orders)
    .set({
      status: wasPaid ? 'refunded' : 'cancelled',
      cancelledAt: new Date(),
      cancelledBy: by,
    })
    .where(eq(orders.id, orderId))
    .returning();

  await enqueueEmail(tx, {
    to: order.customerEmail,
    template: 'order_cancelled',
    payload: { orderId, by, wasPaid },
  });

  return { order: cancelled, releasedSeats: seats };
}

/* -------------------------------------------------------------------------- */
/* Lectures                                                                   */
/* -------------------------------------------------------------------------- */

export interface OrderDetail {
  order: Order;
  event: Event;
  items: {
    quantity: number;
    unitPriceCents: number;
    subtotalCents: number;
    appliedPrice: 'standard' | 'early';
    ticketTypeName: string;
  }[];
  tickets: {
    id: string;
    serial: string;
    holderName: string;
    status: string;
    checkedInAt: Date | null;
    ticketTypeName: string;
  }[];
}

export async function getOrderDetail(
  executor: Executor,
  where: { manageToken?: string; orderId?: string },
): Promise<OrderDetail | null> {
  const condition = where.manageToken
    ? eq(orders.manageToken, where.manageToken)
    : eq(orders.id, where.orderId ?? '');

  const [order] = await executor.select().from(orders).where(condition).limit(1);
  if (!order) return null;

  const [event] = await executor
    .select()
    .from(events)
    .where(eq(events.id, order.eventId))
    .limit(1);

  const items = await executor
    .select({
      quantity: orderItems.quantity,
      unitPriceCents: orderItems.unitPriceCents,
      subtotalCents: orderItems.subtotalCents,
      appliedPrice: orderItems.appliedPrice,
      ticketTypeName: ticketTypes.name,
    })
    .from(orderItems)
    .innerJoin(ticketTypes, eq(ticketTypes.id, orderItems.ticketTypeId))
    .where(eq(orderItems.orderId, order.id));

  const ticketRows = await executor
    .select({
      id: tickets.id,
      serial: tickets.serial,
      holderName: tickets.holderName,
      status: tickets.status,
      checkedInAt: tickets.checkedInAt,
      ticketTypeName: ticketTypes.name,
    })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .where(eq(tickets.orderId, order.id))
    .orderBy(tickets.serial);

  return { order, event, items, tickets: ticketRows };
}

/** Réservations arrivées à échéance, à traiter par le worker. */
export async function findExpiredHolds(executor: Executor, limit = 200): Promise<string[]> {
  const rows = await executor
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, 'pending'), sql`${orders.holdExpiresAt} < now()`))
    .limit(limit);
  return rows.map((r) => r.id);
}
