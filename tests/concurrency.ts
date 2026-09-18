import { loadEnv } from '../src/lib/env';
loadEnv();

import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db';
import { emailOutbox, events, organizations, orders, ticketTypes } from '../src/db/schema';
import { createHold, OrderError } from '../src/server/orders';
import { findOversoldTicketTypes } from '../src/server/inventory';

/**
 * Le test qui compte.
 *
 * Reproduit l'incident du client — plusieurs personnes qui valident le formulaire
 * dans la même seconde — et vérifie qu'il ne peut plus se produire. Il tourne
 * contre un vrai PostgreSQL, parce que c'est précisément le comportement de
 * PostgreSQL sous concurrence que l'on cherche à éprouver : une base simulée
 * prouverait seulement que notre simulation est d'accord avec nous.
 *
 *   npm run test:concurrency
 */

let failures = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function setupEvent(capacity: number): Promise<{ eventId: string; typeId: string }> {
  const [org] = await db
    .insert(organizations)
    .values({
      name: 'Collectif de test',
      slug: `test-${Date.now()}`,
      contactEmail: 'test@example.test',
    })
    .returning();

  const [event] = await db
    .insert(events)
    .values({
      organizationId: org.id,
      slug: `test-event-${Date.now()}`,
      title: 'Concert de test',
      startsAt: new Date(Date.now() + 30 * 86_400_000),
      status: 'published',
      holdMinutesCard: 15,
    })
    .returning();

  const [type] = await db
    .insert(ticketTypes)
    .values({
      eventId: event.id,
      name: 'Balcon',
      priceCents: 2800,
      quantityTotal: capacity,
      maxPerOrder: 10,
    })
    .returning();

  return { eventId: event.id, typeId: type.id };
}

async function cleanup(eventId: string): Promise<void> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (event) {
    await db.delete(organizations).where(eq(organizations.id, event.organizationId));
  }
  // La file d'envoi ne référence pas les commandes par clé étrangère : sans ce
  // nettoyage, chaque passage laisserait des dizaines de messages orphelins
  // dans la base de développement.
  await db.delete(emailOutbox).where(sql`${emailOutbox.toEmail} LIKE '%@example.test'`);
}

/* -------------------------------------------------------------------------- */

/**
 * N tentatives strictement simultanées sur un stock plus petit.
 * Attendu : exactement `capacity / quantityEach` succès, pas une de plus.
 */
async function raceForSeats(label: string, capacity: number, attempts: number, each: number) {
  console.log(`\n${label}`);
  const { eventId, typeId } = await setupEvent(capacity);

  try {
    // Promise.allSettled lance tout d'un coup : c'est le cas du client, trois
    // personnes qui valident dans la même minute — en pire.
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, i) =>
        createHold({
          eventId,
          lines: [{ ticketTypeId: typeId, quantity: each }],
          customer: { name: `Client ${i}`, email: `client${i}@example.test` },
          paymentMethod: 'card',
        }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const soldOut = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof OrderError && r.reason.code === 'sold_out',
    ).length;
    const unexpected = results.filter(
      (r): r is PromiseRejectedResult =>
        r.status === 'rejected' &&
        !(r.reason instanceof OrderError && r.reason.code === 'sold_out'),
    );

    const expected = Math.floor(capacity / each);

    check(
      `exactement ${expected} réservation(s) acceptée(s) sur ${attempts} tentatives`,
      succeeded === expected,
      `obtenu ${succeeded}`,
    );
    check(
      'toutes les autres sont refusées proprement',
      soldOut === attempts - expected,
      `${soldOut} refus « complet », ${unexpected.length} erreur(s) inattendue(s)`,
    );

    if (unexpected.length > 0) {
      console.error('    erreurs inattendues :', unexpected.slice(0, 3).map((r) => r.reason));
    }

    const [type] = await db.select().from(ticketTypes).where(eq(ticketTypes.id, typeId)).limit(1);

    check(
      'le stock détenu ne dépasse jamais la jauge',
      type.quantityReserved <= type.quantityTotal,
      `${type.quantityReserved} / ${type.quantityTotal}`,
    );
    check(
      'le stock détenu correspond aux réservations acceptées',
      type.quantityReserved === succeeded * each,
      `${type.quantityReserved} détenues pour ${succeeded} réservations de ${each}`,
    );

    // Contrôle du nombre de commandes réellement enregistrées : une commande
    // sans stock serait aussi grave qu'une survente.
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.eventId, eventId));

    check('une commande par réservation acceptée', Number(n) === succeeded, `${n} commandes`);
  } finally {
    await cleanup(eventId);
  }
}

/**
 * Commandes concurrentes portant sur deux catégories, dans des ordres opposés.
 * Attendu : aucun interblocage — l'ordre de verrouillage est déterministe.
 */
async function raceAcrossTicketTypes() {
  console.log('\nCommandes croisées sur deux catégories (risque d’interblocage)');

  const [org] = await db
    .insert(organizations)
    .values({
      name: 'Collectif de test',
      slug: `test-cross-${Date.now()}`,
      contactEmail: 'test@example.test',
    })
    .returning();

  const [event] = await db
    .insert(events)
    .values({
      organizationId: org.id,
      slug: `test-cross-${Date.now()}`,
      title: 'Concert à deux catégories',
      startsAt: new Date(Date.now() + 30 * 86_400_000),
      status: 'published',
    })
    .returning();

  const [fosse] = await db
    .insert(ticketTypes)
    .values({ eventId: event.id, name: 'Fosse', priceCents: 2200, quantityTotal: 40 })
    .returning();
  const [balcon] = await db
    .insert(ticketTypes)
    .values({ eventId: event.id, name: 'Balcon', priceCents: 2800, quantityTotal: 40 })
    .returning();

  try {
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) =>
        createHold({
          eventId: event.id,
          // Une commande sur deux demande les catégories dans l'ordre inverse.
          lines:
            i % 2 === 0
              ? [
                  { ticketTypeId: fosse.id, quantity: 1 },
                  { ticketTypeId: balcon.id, quantity: 1 },
                ]
              : [
                  { ticketTypeId: balcon.id, quantity: 1 },
                  { ticketTypeId: fosse.id, quantity: 1 },
                ],
          customer: { name: `Client ${i}`, email: `cross${i}@example.test` },
          paymentMethod: 'card',
        }),
      ),
    );

    const errors = results.filter(
      (r): r is PromiseRejectedResult =>
        r.status === 'rejected' && !(r.reason instanceof OrderError),
    );

    check('aucun interblocage PostgreSQL', errors.length === 0, `${errors.length} erreur(s)`);
    if (errors.length > 0) console.error('   ', errors.slice(0, 2).map((e) => e.reason));

    const types = await db.select().from(ticketTypes).where(eq(ticketTypes.eventId, event.id));
    for (const type of types) {
      check(
        `« ${type.name} » ne dépasse pas sa jauge`,
        type.quantityReserved <= type.quantityTotal,
        `${type.quantityReserved} / ${type.quantityTotal}`,
      );
    }
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(emailOutbox).where(sql`${emailOutbox.toEmail} LIKE '%@example.test'`);
  }
}

/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  console.log('Épreuve de concurrence — anti-survente\n' + '='.repeat(46));

  // Le scénario exact du brief : plus de monde que de places, au même instant.
  await raceForSeats('50 personnes se disputent 10 places', 10, 50, 1);
  await raceForSeats('200 personnes se disputent 25 places', 25, 200, 1);
  await raceForSeats('60 groupes de 2 places pour une jauge de 30', 30, 60, 2);
  await raceAcrossTicketTypes();

  console.log('\nContrôle global');
  const oversold = await findOversoldTicketTypes(db);
  check('aucune catégorie en survente dans toute la base', oversold.length === 0, JSON.stringify(oversold));

  console.log('\n' + '='.repeat(46));
  if (failures === 0) {
    console.log('Tout est vert : la survente est structurellement impossible.');
    process.exit(0);
  } else {
    console.error(`${failures} contrôle(s) en échec.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Épreuve interrompue :', err);
  process.exit(1);
});
