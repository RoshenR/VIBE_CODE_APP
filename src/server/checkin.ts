import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { checkinLogs, orders, ticketTypes, tickets } from '@/db/schema';
import { buildTicketToken, hashToken, verifyTicketToken } from '@/lib/qr';

/**
 * Contrôle d'accès à l'entrée.
 *
 * Deux problèmes distincts à traiter :
 *
 *  1. **Le billet présenté deux fois** (capture d'écran transmise à un ami). Un
 *     QR signé n'y change rien : la copie est un billet valide. Ce qui l'arrête,
 *     c'est que la *première validation* verrouille le billet. Toutes les
 *     suivantes affichent l'heure du premier passage.
 *
 *  2. **La mauvaise connexion à l'entrée d'une salle.** Le scan ne doit pas
 *     dépendre du réseau. L'appareil télécharge un manifeste avant l'ouverture
 *     des portes et valide localement ; les scans sont synchronisés ensuite.
 */

export type ScanOutcome =
  | { result: 'ok'; ticket: ScannedTicket }
  | { result: 'already'; ticket: ScannedTicket; checkedInAt: Date }
  | { result: 'cancelled'; ticket: ScannedTicket }
  | { result: 'wrong_event'; ticket: ScannedTicket }
  | { result: 'invalid'; reason: 'malformed' | 'bad_signature' | 'unknown' };

export interface ScannedTicket {
  id: string;
  serial: string;
  holderName: string;
  ticketTypeName: string;
  orderReference: string;
}

/**
 * Valide un billet scanné.
 *
 * Le passage « non scanné → scanné » est un UPDATE conditionné par
 * `checked_in_at IS NULL`. Deux appareils qui scannent le même billet au même
 * instant : un seul obtient `ok`, l'autre obtient `already`. Aucune fenêtre entre
 * la lecture et l'écriture.
 */
export async function validateScan(input: {
  token: string;
  eventId: string;
  userId?: string | null;
  deviceLabel?: string | null;
  scannedAt?: Date;
  wasOffline?: boolean;
}): Promise<ScanOutcome> {
  const scannedAt = input.scannedAt ?? new Date();
  const verification = verifyTicketToken(input.token);

  if (!verification.ok) {
    await logScan({
      eventId: input.eventId,
      ticketId: null,
      result: 'invalid',
      scannedAt,
      deviceLabel: input.deviceLabel,
      wasOffline: input.wasOffline,
    });
    return { result: 'invalid', reason: verification.reason };
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: tickets.id,
        serial: tickets.serial,
        holderName: tickets.holderName,
        status: tickets.status,
        eventId: tickets.eventId,
        checkedInAt: tickets.checkedInAt,
        ticketTypeName: ticketTypes.name,
        orderReference: orders.reference,
      })
      .from(tickets)
      .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
      .innerJoin(orders, eq(orders.id, tickets.orderId))
      .where(eq(tickets.id, verification.ticketId))
      .limit(1);

    if (!row) {
      await logScan(
        {
          eventId: input.eventId,
          ticketId: null,
          result: 'invalid',
          scannedAt,
          deviceLabel: input.deviceLabel,
          wasOffline: input.wasOffline,
        },
        tx,
      );
      return { result: 'invalid', reason: 'unknown' } as ScanOutcome;
    }

    const ticket: ScannedTicket = {
      id: row.id,
      serial: row.serial,
      holderName: row.holderName,
      ticketTypeName: row.ticketTypeName,
      orderReference: row.orderReference,
    };

    // Billet d'un autre concert : cas classique quand l'équipe enchaîne deux
    // dates et garde le même téléphone en main.
    if (row.eventId !== input.eventId) {
      await logScan(
        {
          eventId: input.eventId,
          ticketId: row.id,
          result: 'wrong_event',
          scannedAt,
          deviceLabel: input.deviceLabel,
          wasOffline: input.wasOffline,
        },
        tx,
      );
      return { result: 'wrong_event', ticket } as ScanOutcome;
    }

    if (row.status !== 'valid') {
      await logScan(
        {
          eventId: input.eventId,
          ticketId: row.id,
          result: 'cancelled',
          scannedAt,
          deviceLabel: input.deviceLabel,
          wasOffline: input.wasOffline,
        },
        tx,
      );
      return { result: 'cancelled', ticket } as ScanOutcome;
    }

    // Le verrou : seul le premier scan passe.
    const claimed = await tx
      .update(tickets)
      .set({
        checkedInAt: scannedAt,
        checkedInBy: input.userId ?? null,
        checkedInDevice: input.deviceLabel ?? null,
      })
      .where(and(eq(tickets.id, row.id), sql`${tickets.checkedInAt} IS NULL`))
      .returning({ checkedInAt: tickets.checkedInAt });

    if (claimed.length === 0) {
      await logScan(
        {
          eventId: input.eventId,
          ticketId: row.id,
          result: 'already',
          scannedAt,
          deviceLabel: input.deviceLabel,
          wasOffline: input.wasOffline,
        },
        tx,
      );
      return {
        result: 'already',
        ticket,
        checkedInAt: row.checkedInAt ?? scannedAt,
      } as ScanOutcome;
    }

    await logScan(
      {
        eventId: input.eventId,
        ticketId: row.id,
        result: 'ok',
        scannedAt,
        deviceLabel: input.deviceLabel,
        wasOffline: input.wasOffline,
      },
      tx,
    );

    return { result: 'ok', ticket } as ScanOutcome;
  });
}

async function logScan(
  entry: {
    eventId: string;
    ticketId: string | null;
    result: 'ok' | 'already' | 'invalid' | 'wrong_event' | 'cancelled';
    scannedAt: Date;
    deviceLabel?: string | null;
    wasOffline?: boolean;
  },
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0] = db,
): Promise<void> {
  await executor.insert(checkinLogs).values({
    eventId: entry.eventId,
    ticketId: entry.ticketId,
    result: entry.result,
    scannedAt: entry.scannedAt,
    deviceLabel: entry.deviceLabel ?? null,
    wasOffline: entry.wasOffline ?? false,
  });
}

/* -------------------------------------------------------------------------- */
/* Manifeste hors ligne                                                       */
/* -------------------------------------------------------------------------- */

export interface ManifestEntry {
  /** Empreinte SHA-256 du contenu du QR — jamais le jeton lui-même. */
  h: string;
  /** Identifiant du billet, renvoyé lors de la synchronisation. */
  i: string;
  s: string; // numéro de série
  n: string; // nom du porteur
  t: string; // catégorie de place
  /** Déjà scanné au moment du téléchargement (en millisecondes epoch). */
  c: number | null;
}

/**
 * Manifeste téléchargé par les téléphones de l'équipe avant l'ouverture des portes.
 *
 * Il ne contient **que des empreintes** des jetons. Un appareil perdu ou volé ne
 * permet donc pas de fabriquer des billets valides : on peut vérifier qu'un QR
 * scanné figure dans la liste, pas reconstituer son contenu.
 */
export async function buildManifest(eventId: string): Promise<{
  eventId: string;
  generatedAt: string;
  entries: ManifestEntry[];
}> {
  const rows = await db
    .select({
      id: tickets.id,
      serial: tickets.serial,
      holderName: tickets.holderName,
      checkedInAt: tickets.checkedInAt,
      ticketTypeName: ticketTypes.name,
    })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .where(and(eq(tickets.eventId, eventId), eq(tickets.status, 'valid')))
    .orderBy(tickets.serial);

  return {
    eventId,
    generatedAt: new Date().toISOString(),
    entries: rows.map((r) => ({
      h: hashToken(buildTicketToken(r.id)),
      i: r.id,
      s: r.serial,
      n: r.holderName,
      t: r.ticketTypeName,
      c: r.checkedInAt ? r.checkedInAt.getTime() : null,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Synchronisation des scans hors ligne                                       */
/* -------------------------------------------------------------------------- */

export interface OfflineScan {
  ticketId: string;
  scannedAt: string; // ISO
  deviceLabel?: string;
}

export interface SyncReport {
  accepted: number;
  /** Billets scannés sur plusieurs appareils déconnectés : à vérifier en salle. */
  conflicts: { ticketId: string; serial: string; firstScanAt: Date; device: string | null }[];
}

/**
 * Réintègre les scans effectués hors ligne.
 *
 * Le serveur reste l'autorité : le **premier scan par horodatage** l'emporte. Si
 * le même billet a été scanné sur deux appareils déconnectés, le second est
 * signalé comme conflit plutôt que silencieusement ignoré — l'équipe doit pouvoir
 * en discuter en salle.
 */
export async function syncOfflineScans(
  eventId: string,
  scans: OfflineScan[],
  userId?: string | null,
): Promise<SyncReport> {
  const report: SyncReport = { accepted: 0, conflicts: [] };

  // Ordre chronologique : le plus ancien scan doit gagner, quel que soit l'ordre
  // dans lequel les appareils se reconnectent.
  const ordered = [...scans].sort(
    (a, b) => new Date(a.scannedAt).getTime() - new Date(b.scannedAt).getTime(),
  );

  for (const scan of ordered) {
    const scannedAt = new Date(scan.scannedAt);

    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(tickets)
        .set({
          checkedInAt: scannedAt,
          checkedInBy: userId ?? null,
          checkedInDevice: scan.deviceLabel ?? null,
        })
        .where(
          and(
            eq(tickets.id, scan.ticketId),
            eq(tickets.eventId, eventId),
            eq(tickets.status, 'valid'),
            sql`${tickets.checkedInAt} IS NULL`,
          ),
        )
        .returning({ id: tickets.id });

      await tx.insert(checkinLogs).values({
        eventId,
        ticketId: scan.ticketId,
        result: claimed.length > 0 ? 'ok' : 'already',
        scannedAt,
        deviceLabel: scan.deviceLabel ?? null,
        wasOffline: true,
      });

      if (claimed.length > 0) {
        report.accepted++;
        return;
      }

      const [existing] = await tx
        .select({
          serial: tickets.serial,
          checkedInAt: tickets.checkedInAt,
          device: tickets.checkedInDevice,
        })
        .from(tickets)
        .where(eq(tickets.id, scan.ticketId))
        .limit(1);

      // Conflit réel seulement si un AUTRE appareil avait déjà validé ce billet.
      if (existing?.checkedInAt && existing.device !== (scan.deviceLabel ?? null)) {
        report.conflicts.push({
          ticketId: scan.ticketId,
          serial: existing.serial,
          firstScanAt: existing.checkedInAt,
          device: existing.device,
        });
      }
    });
  }

  return report;
}

/** Compteur d'entrées affiché en direct pendant la soirée. */
export async function getCheckinStats(eventId: string): Promise<{
  total: number;
  checkedIn: number;
  remaining: number;
}> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      checkedIn: sql<number>`count(${tickets.checkedInAt})::int`,
    })
    .from(tickets)
    .where(and(eq(tickets.eventId, eventId), eq(tickets.status, 'valid')));

  const total = Number(row?.total ?? 0);
  const checkedIn = Number(row?.checkedIn ?? 0);
  return { total, checkedIn, remaining: total - checkedIn };
}
