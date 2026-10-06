import { loadEnv } from '../src/lib/env';
loadEnv();

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../src/db';
import { emailOutbox, orders } from '../src/db/schema';
import { expireOrder, findExpiredHolds } from '../src/server/orders';
import { expireStaleOffers, offerNextInLine } from '../src/server/waitlist';
import { enqueueEmail } from '../src/server/outbox';
import { renderEmail } from '../src/emails/templates';
import { sendMail } from '../src/lib/mailer';
import { purgeExpired as purgeRateLimits } from '../src/lib/security/rate-limit';
import { purgeStale as purgeLockouts } from '../src/lib/security/lockout';
import { assertSecretsAreSafe } from '../src/lib/security/config';
import type { EmailTemplate } from '../src/server/outbox';

/**
 * Tâches de fond.
 *
 * Sans ce processus, rien n'expire : les réservations impayées garderaient leurs
 * places indéfiniment et la liste d'attente n'avancerait jamais. Il fait partie
 * intégrante du produit, pas d'un confort d'exploitation — d'où sa présence dans
 * docker-compose.yml.
 *
 * Le rythme est volontairement lent : à l'échelle de quinze événements par an,
 * une scrutation SQL toutes les trente secondes coûte moins cher à exploiter
 * qu'une file de messages supplémentaire à maintenir.
 */

const INTERVALS = {
  expireHolds: 30_000,
  reminders: 60_000,
  waitlistOffers: 60_000,
  outbox: 5_000,
  housekeeping: 3_600_000,
};

let stopping = false;

function log(scope: string, message: string, extra?: unknown): void {
  const line = `[${new Date().toISOString()}] ${scope} — ${message}`;
  if (extra !== undefined) console.log(line, extra);
  else console.log(line);
}

/* -------------------------------------------------------------------------- */
/* 1. Expiration des réservations non payées                                  */
/* -------------------------------------------------------------------------- */

async function expireHolds(): Promise<void> {
  const ids = await findExpiredHolds(db, 200);
  if (ids.length === 0) return;

  const touchedEvents = new Set<string>();

  for (const orderId of ids) {
    try {
      const expired = await db.transaction(async (tx) => {
        const [order] = await tx
          .select({ eventId: orders.eventId })
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);
        const done = await expireOrder(tx, orderId);
        return done ? order?.eventId ?? null : null;
      });

      if (expired) touchedEvents.add(expired);
    } catch (err) {
      log('holds', `échec sur la commande ${orderId}`, err);
    }
  }

  if (touchedEvents.size > 0) {
    log('holds', `${ids.length} réservation(s) expirée(s), places relâchées`);
  }

  // Les places libérées partent aussitôt à la liste d'attente.
  for (const eventId of touchedEvents) {
    try {
      const sent = await offerNextInLine(eventId);
      if (sent > 0) log('waitlist', `${sent} offre(s) envoyée(s) pour ${eventId}`);
    } catch (err) {
      log('waitlist', `échec de distribution pour ${eventId}`, err);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 2. Rappel avant expiration                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Prévient le client à mi-parcours du délai qui lui est accordé.
 *
 * `reminder_sent_at IS NULL` dans la clause WHERE de l'UPDATE garantit qu'un
 * rappel n'est envoyé qu'une fois, même si deux workers tournaient en parallèle.
 */
async function sendReminders(): Promise<void> {
  const candidates = await db
    .select({ id: orders.id, email: orders.customerEmail })
    .from(orders)
    .where(
      and(
        eq(orders.status, 'pending'),
        sql`${orders.reminderSentAt} IS NULL`,
        sql`${orders.holdExpiresAt} IS NOT NULL`,
        // Mi-parcours entre la création et l'échéance.
        sql`now() >= ${orders.createdAt} + (${orders.holdExpiresAt} - ${orders.createdAt}) / 2`,
      ),
    )
    .limit(100);

  for (const candidate of candidates) {
    try {
      await db.transaction(async (tx) => {
        const claimed = await tx
          .update(orders)
          .set({ reminderSentAt: new Date() })
          .where(and(eq(orders.id, candidate.id), sql`${orders.reminderSentAt} IS NULL`))
          .returning({ id: orders.id });

        if (claimed.length === 0) return;

        await enqueueEmail(tx, {
          to: candidate.email,
          template: 'order_reminder',
          payload: { orderId: candidate.id },
        });
      });
    } catch (err) {
      log('reminders', `échec sur ${candidate.id}`, err);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 3. Offres de liste d'attente sans réponse                                  */
/* -------------------------------------------------------------------------- */

async function rotateWaitlist(): Promise<void> {
  const expired = await expireStaleOffers();
  if (expired > 0) log('waitlist', `${expired} offre(s) sans réponse, passage au suivant`);
}

/* -------------------------------------------------------------------------- */
/* 4. File d'envoi des e-mails                                                */
/* -------------------------------------------------------------------------- */

const MAX_ATTEMPTS = 5;

/**
 * Envoie les e-mails en attente.
 *
 * Chaque message est verrouillé par un UPDATE conditionnel avant envoi : deux
 * workers ne peuvent pas envoyer le même e-mail deux fois. Un échec est réessayé
 * avec un délai croissant, puis marqué en erreur et visible dans l'admin — un
 * billet qui n'arrive pas ne doit jamais disparaître en silence.
 */
async function processOutbox(): Promise<void> {
  const batch = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, 'pending'), sql`${emailOutbox.availableAt} <= now()`))
    // L'ordre est explicite : sans lui, PostgreSQL est libre de renvoyer
    // toujours les mêmes lignes, et un billet légitime pourrait attendre
    // indéfiniment derrière un arriéré de messages en échec.
    .orderBy(emailOutbox.availableAt, emailOutbox.createdAt)
    .limit(20);

  for (const { id } of batch) {
    const claimed = await db
      .update(emailOutbox)
      .set({ attempts: sql`${emailOutbox.attempts} + 1` })
      .where(and(eq(emailOutbox.id, id), eq(emailOutbox.status, 'pending')))
      .returning();

    if (claimed.length === 0) continue;
    const message = claimed[0];

    try {
      const rendered = await renderEmail(
        message.template as EmailTemplate,
        message.payload as Record<string, unknown>,
      );

      // Rendu vide = le contexte n'a plus lieu d'être (commande déjà réglée
      // entre-temps, par exemple). Ce n'est pas une erreur.
      if (!rendered) {
        await db
          .update(emailOutbox)
          .set({ status: 'sent', sentAt: new Date(), lastError: 'rendu vide, ignoré' })
          .where(eq(emailOutbox.id, id));
        continue;
      }

      await sendMail({ to: message.toEmail, ...rendered });

      await db
        .update(emailOutbox)
        .set({ status: 'sent', sentAt: new Date() })
        .where(eq(emailOutbox.id, id));

      log('mail', `${message.template} → ${message.toEmail}`);
    } catch (err) {
      const reachedLimit = message.attempts >= MAX_ATTEMPTS;
      const backoffMs = Math.min(2 ** message.attempts, 60) * 60_000;

      await db
        .update(emailOutbox)
        .set({
          status: reachedLimit ? 'failed' : 'pending',
          lastError: err instanceof Error ? err.message : String(err),
          availableAt: new Date(Date.now() + backoffMs),
        })
        .where(eq(emailOutbox.id, id));

      log('mail', `échec ${message.template} → ${message.toEmail}`, err);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 5. Entretien                                                               */
/* -------------------------------------------------------------------------- */

async function housekeeping(): Promise<void> {
  // Sessions échues. Les sessions actives, elles, sont fermées par leur double
  // échéance (absolue et par inactivité), contrôlée à chaque lecture.
  await db.execute(sql`DELETE FROM sessions WHERE expires_at < now()`);

  // Compteurs de débit périmés : sans purge, la table grossit indéfiniment.
  await purgeRateLimits();

  // Séries d'échecs de connexion anciennes et déverrouillées.
  await purgeLockouts();

  // Le journal d'audit n'est JAMAIS purgé ici : c'est une pièce justificative.
  // Sa conservation relève d'une décision de l'équipe, pas d'une tâche de fond.
}

/* -------------------------------------------------------------------------- */
/* Boucle principale                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Exécute une tâche à intervalle régulier, en attendant la fin de l'itération
 * précédente. Une tâche lente ne peut donc pas se chevaucher avec elle-même.
 */
function schedule(name: string, fn: () => Promise<void>, intervalMs: number): void {
  const run = async (): Promise<void> => {
    if (stopping) return;
    try {
      await fn();
    } catch (err) {
      log(name, 'erreur non rattrapée', err);
    } finally {
      if (!stopping) setTimeout(run, intervalMs);
    }
  };
  void run();
}

async function main(): Promise<void> {
  // Même contrôle que l'application : le worker signe des liens et rend des
  // e-mails, il ne doit pas tourner avec des secrets publics.
  // Le worker signe des billets et des liens, mais ne reçoit jamais de webhook : il n'a
  // pas besoin — et ne doit donc pas recevoir — le secret des notifications de paiement.
  assertSecretsAreSafe(['TICKET_SIGNING_SECRET', 'LINK_SIGNING_SECRET']);

  log('worker', 'démarrage');

  schedule('holds', expireHolds, INTERVALS.expireHolds);
  schedule('reminders', sendReminders, INTERVALS.reminders);
  schedule('waitlist', rotateWaitlist, INTERVALS.waitlistOffers);
  schedule('outbox', processOutbox, INTERVALS.outbox);
  schedule('housekeeping', housekeeping, INTERVALS.housekeeping);

  const shutdown = (signal: string) => {
    log('worker', `arrêt (${signal})`);
    stopping = true;
    setTimeout(() => process.exit(0), 1000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main();
