import { loadEnv } from '../src/lib/env';
loadEnv();

import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db';
import {
  emailOutbox,
  events,
  organizations,
  ticketTypes,
  tickets,
} from '../src/db/schema';
import { createHold, confirmOrder } from '../src/server/orders';
import { buildManifest, syncOfflineScans, validateScan } from '../src/server/checkin';
import { buildTicketToken, hashToken } from '../src/lib/qr';

/**
 * Épreuve du contrôle à l'entrée.
 *
 * Reproduit : « avec des captures d'écran, on a déjà eu des billets présentés
 * deux fois », et le contrôle sans réseau à l'entrée d'une salle.
 *
 *   npm run test:checkin
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
  console.log("Épreuve du contrôle à l'entrée\n" + '='.repeat(42));

  const [org] = await db
    .insert(organizations)
    .values({
      name: 'Collectif de test',
      slug: `test-ci-${Date.now()}`,
      contactEmail: 'test@example.test',
    })
    .returning();

  const [event] = await db
    .insert(events)
    .values({
      organizationId: org.id,
      slug: `test-ci-${Date.now()}`,
      title: 'Concert de test',
      startsAt: new Date(Date.now() + 86_400_000),
      status: 'published',
    })
    .returning();

  const [autre] = await db
    .insert(events)
    .values({
      organizationId: org.id,
      slug: `test-ci-autre-${Date.now()}`,
      title: 'Autre date',
      startsAt: new Date(Date.now() + 2 * 86_400_000),
      status: 'published',
    })
    .returning();

  const [type] = await db
    .insert(ticketTypes)
    .values({ eventId: event.id, name: 'Fosse', priceCents: 2200, quantityTotal: 10 })
    .returning();

  try {
    const { order } = await createHold({
      eventId: event.id,
      lines: [{ ticketTypeId: type.id, quantity: 3 }],
      customer: { name: 'Camille Roy', email: 'camille@example.test' },
      paymentMethod: 'card',
    });
    await db.transaction((tx) => confirmOrder(tx, order.id, { source: 'test' }));

    const emis = await db.select().from(tickets).where(eq(tickets.orderId, order.id));
    check('3 billets émis', emis.length === 3, `${emis.length}`);

    /* --- Le cas de la capture d'écran ------------------------------------ */

    console.log("\nBillet présenté deux fois (capture d'écran partagée)");

    const jeton = buildTicketToken(emis[0].id);

    const premier = await validateScan({ token: jeton, eventId: event.id, deviceLabel: 'porte-A' });
    check('premier passage accepté', premier.result === 'ok', premier.result);

    const second = await validateScan({ token: jeton, eventId: event.id, deviceLabel: 'porte-A' });
    check('second passage refusé', second.result === 'already', second.result);
    check(
      "l'heure du premier passage est restituée",
      second.result === 'already' && second.checkedInAt instanceof Date,
    );

    /* --- Deux portes qui scannent au même instant ------------------------ */

    console.log('\nDeux portes scannent le même billet simultanément');

    const jeton2 = buildTicketToken(emis[1].id);
    const simultanes = await Promise.all([
      validateScan({ token: jeton2, eventId: event.id, deviceLabel: 'porte-A' }),
      validateScan({ token: jeton2, eventId: event.id, deviceLabel: 'porte-B' }),
      validateScan({ token: jeton2, eventId: event.id, deviceLabel: 'porte-C' }),
    ]);
    const acceptes = simultanes.filter((r) => r.result === 'ok').length;
    check('un seul scan accepté sur trois', acceptes === 1, `${acceptes} acceptés`);

    /* --- Billets impossibles --------------------------------------------- */

    console.log('\nBillets invalides');

    const forge = jeton.replace(/\.[^.]+$/, '.signatureInventee');
    const r1 = await validateScan({ token: forge, eventId: event.id });
    check('signature falsifiée refusée', r1.result === 'invalid', r1.result);

    const r2 = await validateScan({ token: 'nimporte quoi', eventId: event.id });
    check('code étranger refusé', r2.result === 'invalid', r2.result);

    const r3 = await validateScan({ token: buildTicketToken(emis[2].id), eventId: autre.id });
    check("billet d'un autre concert refusé", r3.result === 'wrong_event', r3.result);
    const [pasScanne] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, emis[2].id))
      .limit(1);
    check(
      "un refus « autre concert » ne consomme pas le billet",
      pasScanne.checkedInAt === null,
    );

    /* --- Manifeste hors ligne -------------------------------------------- */

    console.log('\nManifeste hors ligne');

    const manifeste = await buildManifest(event.id);
    check('les 3 billets y figurent', manifeste.entries.length === 3, `${manifeste.entries.length}`);

    const empreinte = hashToken(buildTicketToken(emis[2].id));
    check(
      "l'empreinte du billet permet de le retrouver",
      manifeste.entries.some((e) => e.h === empreinte),
    );

    const fuite = manifeste.entries.some(
      (e) => e.h.includes(emis[2].id) || JSON.stringify(e).includes(buildTicketToken(emis[2].id)),
    );
    check("le manifeste ne contient aucun jeton en clair", !fuite);

    const dejaScanne = manifeste.entries.find((e) => e.i === emis[0].id);
    check('les passages déjà faits sont signalés', dejaScanne?.c !== null);

    /* --- Synchronisation des scans hors ligne ---------------------------- */

    console.log('\nSynchronisation après coupure réseau');

    const horsLigne = new Date(Date.now() - 300_000).toISOString();
    const rapport = await syncOfflineScans(event.id, [
      { ticketId: emis[2].id, scannedAt: horsLigne, deviceLabel: 'porte-A' },
    ]);
    check('le scan hors ligne est intégré', rapport.accepted === 1, `${rapport.accepted}`);
    check('aucun conflit signalé', rapport.conflicts.length === 0);

    const [remonte] = await db.select().from(tickets).where(eq(tickets.id, emis[2].id)).limit(1);
    check(
      "l'heure réelle du scan est conservée, pas celle de la synchronisation",
      remonte.checkedInAt?.toISOString() === horsLigne,
      String(remonte.checkedInAt?.toISOString()),
    );

    /* --- Conflit entre deux postes déconnectés --------------------------- */

    console.log('\nMême billet scanné sur deux postes déconnectés');

    const conflit = await syncOfflineScans(event.id, [
      { ticketId: emis[2].id, scannedAt: new Date().toISOString(), deviceLabel: 'porte-B' },
    ]);
    check('le second scan est refusé', conflit.accepted === 0);
    check(
      'le conflit est signalé et non masqué',
      conflit.conflicts.length === 1,
      `${conflit.conflicts.length} conflit(s)`,
    );
    check(
      "le conflit nomme le billet concerné",
      conflit.conflicts[0]?.serial === remonte.serial,
    );
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(emailOutbox).where(sql`${emailOutbox.toEmail} LIKE '%@example.test'`);
  }

  console.log('\n' + '='.repeat(42));
  if (failures === 0) {
    console.log("Un billet ne passe qu'une fois, avec ou sans réseau.");
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
