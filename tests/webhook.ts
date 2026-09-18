import { loadEnv } from '../src/lib/env';
loadEnv();

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db';
import {
  emailOutbox,
  events,
  organizations,
  orderItems,
  orders,
  paymentEvents,
  ticketTypes,
  tickets,
} from '../src/db/schema';
import { createHold } from '../src/server/orders';
import { handleWebhookEvent } from '../src/server/payments';

/**
 * Épreuve d'idempotence du paiement.
 *
 * Reproduit l'incident : « parfois il l'envoie deux fois … ça nous a créé deux
 * billets pour un seul paiement, et la personne est venue avec un ami ».
 *
 *   npm run test:webhook
 */

let failures = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  console.log("Épreuve d'idempotence — notification de paiement\n" + '='.repeat(48));

  // Identifiants uniques à chaque passage. Le journal des notifications est
  // volontairement conservé quand une commande disparaît — il trace de l'argent
  // reçu. Réutiliser un identifiant ferait échouer l'épreuve au second
  // lancement, et cet échec-là ne dirait qu'une chose : que l'idempotence
  // fonctionne.
  const notificationId = `evt_test_${randomUUID()}`;
  const autreNotificationId = `evt_test_${randomUUID()}`;
  const providerRef = `sim_test_${randomUUID()}`;

  const [org] = await db
    .insert(organizations)
    .values({
      name: 'Collectif de test',
      slug: `test-wh-${Date.now()}`,
      contactEmail: 'test@example.test',
    })
    .returning();

  const [event] = await db
    .insert(events)
    .values({
      organizationId: org.id,
      slug: `test-wh-${Date.now()}`,
      title: 'Concert de test',
      startsAt: new Date(Date.now() + 30 * 86_400_000),
      status: 'published',
    })
    .returning();

  const [type] = await db
    .insert(ticketTypes)
    .values({ eventId: event.id, name: 'Fosse', priceCents: 2200, quantityTotal: 100 })
    .returning();

  try {
    const { order } = await createHold({
      eventId: event.id,
      lines: [{ ticketTypeId: type.id, quantity: 2 }],
      customer: { name: 'Camille Roy', email: 'camille@example.test' },
      paymentMethod: 'card',
    });

    const notification = {
      id: notificationId,
      type: 'payment_succeeded' as const,
      providerRef,
      orderId: order.id,
      amountCents: order.totalCents,
      raw: { id: notificationId },
    };

    console.log('\nPremière notification');
    const first = await handleWebhookEvent(notification);
    check('traitée', first.status === 'processed', first.status);

    console.log('\nLa même notification, renvoyée quatre fois');
    const replays = [];
    for (let i = 0; i < 4; i++) replays.push(await handleWebhookEvent(notification));
    check(
      'toutes reconnues comme doublons',
      replays.every((r) => r.status === 'duplicate'),
      replays.map((r) => r.status).join(', '),
    );

    console.log('\nÉtat final');

    const ticketRows = await db.select().from(tickets).where(eq(tickets.orderId, order.id));
    check('2 billets émis, pas 4 ni 10', ticketRows.length === 2, `${ticketRows.length} billets`);

    const serials = new Set(ticketRows.map((t) => t.serial));
    check('les numéros de billets sont uniques', serials.size === ticketRows.length);

    const [refreshed] = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1);
    check('la commande est payée une seule fois', refreshed.status === 'paid', refreshed.status);

    const [{ n: eventCount }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(paymentEvents)
      .where(eq(paymentEvents.providerEventId, notificationId));
    check('une seule notification enregistrée', Number(eventCount) === 1, `${eventCount} lignes`);

    const [refreshedType] = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.id, type.id))
      .limit(1);
    check(
      'le stock vendu correspond aux billets réels',
      refreshedType.quantitySold === 2,
      `${refreshedType.quantitySold} vendues`,
    );
    check(
      'aucune place détenue en trop',
      refreshedType.quantityReserved === 2,
      `${refreshedType.quantityReserved} détenues`,
    );

    // Deuxième scénario : deux identifiants différents pour la même commande.
    // La première barrière ne joue pas ; c'est la seconde qui doit tenir.
    console.log('\nDeux identifiants différents pour le même paiement');
    const second = await handleWebhookEvent({ ...notification, id: autreNotificationId });
    check(
      'le second paiement ne crée pas de billets supplémentaires',
      (await db.select().from(tickets).where(eq(tickets.orderId, order.id))).length === 2,
      `statut renvoyé : ${second.status}`,
    );

    const itemRows = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    check('les lignes de commande sont intactes', itemRows.length === 1);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    // Ni la file d'envoi ni le journal des notifications n'ont de clé étrangère
    // vers les commandes : on retire nous-mêmes les traces du jeu de test.
    await db.delete(emailOutbox).where(sql`${emailOutbox.toEmail} LIKE '%@example.test'`);
    await db
      .delete(paymentEvents)
      .where(sql`${paymentEvents.providerEventId} LIKE 'evt_test_%'`);
  }

  console.log('\n' + '='.repeat(48));
  if (failures === 0) {
    console.log('Une notification répétée ne produit jamais de billet en double.');
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
