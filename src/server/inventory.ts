import { sql } from 'drizzle-orm';
import type { Executor } from '@/db';

/**
 * Gestion du stock de places.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ RÈGLE ABSOLUE : on ne lit jamais le stock pour décider ensuite d'écrire.   │
 * │                                                                           │
 * │ Un `if (placesDisponibles >= n) { reserver(n) }` laisse une fenêtre entre  │
 * │ la lecture et l'écriture. C'est exactement ce qui a produit les 12 places  │
 * │ vendues en trop en balcon : trois personnes ont lu « 12 disponibles » au   │
 * │ même instant, puis ont toutes écrit.                                      │
 * │                                                                           │
 * │ Ici, la condition et la mutation sont dans UNE SEULE instruction SQL. La   │
 * │ ligne est verrouillée par l'UPDATE lui-même ; en isolation READ COMMITTED, │
 * │ une transaction concurrente qui bute sur ce verrou réévalue sa clause      │
 * │ WHERE sur la version à jour de la ligne après libération. La garantie      │
 * │ tient donc quel que soit le nombre de clics simultanés, sans verrou        │
 * │ applicatif ni isolation SERIALIZABLE.                                     │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

export interface SeatRequest {
  ticketTypeId: string;
  quantity: number;
}

export class InsufficientStockError extends Error {
  constructor(
    readonly ticketTypeId: string,
    readonly requested: number,
    readonly available: number,
  ) {
    super(
      `Stock insuffisant : ${requested} place(s) demandée(s), ${available} disponible(s).`,
    );
    this.name = 'InsufficientStockError';
  }
}

/** Le pilote renvoie soit un tableau de lignes, soit un objet `{ rows }`. */
function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const maybe = result as { rows?: T[] };
  return maybe?.rows ?? [];
}

/**
 * Regroupe les lignes portant sur la même catégorie et trie par identifiant.
 *
 * L'ordre déterministe est ce qui rend tout interblocage impossible quand deux
 * commandes concurrentes portent sur les mêmes catégories dans un ordre différent
 * (A puis B / B puis A).
 */
function normalize(requests: SeatRequest[]): SeatRequest[] {
  const merged = new Map<string, number>();
  for (const { ticketTypeId, quantity } of requests) {
    if (quantity <= 0) continue;
    merged.set(ticketTypeId, (merged.get(ticketTypeId) ?? 0) + quantity);
  }
  return [...merged.entries()]
    .map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }))
    .sort((a, b) => a.ticketTypeId.localeCompare(b.ticketTypeId));
}

/**
 * Détient les places demandées, ou échoue.
 *
 * DOIT être appelée à l'intérieur d'une transaction : si une catégorie manque de
 * stock, l'annulation de la transaction doit relâcher les places déjà prises pour
 * les autres catégories de la même commande.
 *
 * @throws InsufficientStockError dès qu'une catégorie ne peut pas être servie.
 */
export async function reserveSeats(tx: Executor, requests: SeatRequest[]): Promise<void> {
  for (const { ticketTypeId, quantity } of normalize(requests)) {
    const updated = toRows<{ remaining: number }>(
      await tx.execute(sql`
        UPDATE ticket_types
           SET quantity_reserved = quantity_reserved + ${quantity}
         WHERE id = ${ticketTypeId}
           AND quantity_reserved + ${quantity} <= quantity_total
        RETURNING quantity_total - quantity_reserved AS remaining
      `),
    );

    if (updated.length === 0) {
      // Échec : on relit le stock uniquement pour produire un message utile.
      const current = toRows<{ available: number }>(
        await tx.execute(sql`
          SELECT quantity_total - quantity_reserved AS available
            FROM ticket_types
           WHERE id = ${ticketTypeId}
        `),
      );
      throw new InsufficientStockError(
        ticketTypeId,
        quantity,
        Number(current[0]?.available ?? 0),
      );
    }
  }
}

/**
 * Relâche des places détenues (réservation expirée, commande annulée).
 *
 * `GREATEST(0, ...)` garantit qu'un double relâchement — un worker qui repasse,
 * une annulation simultanée — ne peut pas faire descendre le compteur sous zéro
 * et donc créer du stock fantôme.
 */
export async function releaseSeats(tx: Executor, requests: SeatRequest[]): Promise<void> {
  for (const { ticketTypeId, quantity } of normalize(requests)) {
    await tx.execute(sql`
      UPDATE ticket_types
         SET quantity_reserved = GREATEST(0, quantity_reserved - ${quantity})
       WHERE id = ${ticketTypeId}
    `);
  }
}

/**
 * Bascule des places « détenues » en « vendues ».
 *
 * `quantityReserved` reste inchangé : une place payée reste détenue. Seul
 * `quantitySold` bouge, pour le tableau de bord.
 */
export async function markSeatsSold(tx: Executor, requests: SeatRequest[]): Promise<void> {
  for (const { ticketTypeId, quantity } of normalize(requests)) {
    await tx.execute(sql`
      UPDATE ticket_types
         SET quantity_sold = quantity_sold + ${quantity}
       WHERE id = ${ticketTypeId}
    `);
  }
}

/** Remboursement ou annulation après paiement : le stock redevient disponible. */
export async function releaseSoldSeats(tx: Executor, requests: SeatRequest[]): Promise<void> {
  for (const { ticketTypeId, quantity } of normalize(requests)) {
    await tx.execute(sql`
      UPDATE ticket_types
         SET quantity_reserved = GREATEST(0, quantity_reserved - ${quantity}),
             quantity_sold     = GREATEST(0, quantity_sold - ${quantity})
       WHERE id = ${ticketTypeId}
    `);
  }
}

export interface Availability {
  ticketTypeId: string;
  name: string;
  total: number;
  reserved: number;
  sold: number;
  available: number;
}

export async function getAvailability(
  tx: Executor,
  eventId: string,
): Promise<Availability[]> {
  const rows = toRows<{
    id: string;
    name: string;
    quantity_total: number;
    quantity_reserved: number;
    quantity_sold: number;
  }>(
    await tx.execute(sql`
      SELECT id, name, quantity_total, quantity_reserved, quantity_sold
        FROM ticket_types
       WHERE event_id = ${eventId}
       ORDER BY position, name
    `),
  );

  return rows.map((r) => ({
    ticketTypeId: r.id,
    name: r.name,
    total: Number(r.quantity_total),
    reserved: Number(r.quantity_reserved),
    sold: Number(r.quantity_sold),
    available: Number(r.quantity_total) - Number(r.quantity_reserved),
  }));
}

/**
 * Contrôle d'intégrité, exposé dans l'admin et utilisé par les tests.
 *
 * Si cette fonction renvoie une anomalie, c'est qu'une écriture est passée à côté
 * de ce module — le genre d'incident qui doit être visible immédiatement.
 */
export async function findOversoldTicketTypes(tx: Executor): Promise<
  { ticketTypeId: string; name: string; total: number; reserved: number }[]
> {
  const rows = toRows<{
    id: string;
    name: string;
    quantity_total: number;
    quantity_reserved: number;
  }>(
    await tx.execute(sql`
      SELECT id, name, quantity_total, quantity_reserved
        FROM ticket_types
       WHERE quantity_reserved > quantity_total
          OR quantity_sold > quantity_total
    `),
  );

  return rows.map((r) => ({
    ticketTypeId: r.id,
    name: r.name,
    total: Number(r.quantity_total),
    reserved: Number(r.quantity_reserved),
  }));
}
