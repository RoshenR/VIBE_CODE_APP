import { loadEnv } from '../lib/env';
loadEnv();

import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from './index';
import { events, organizations, ticketTypes, users } from './schema';

/**
 * Jeu de données de démonstration.
 *
 * Reproduit la situation décrite par le client : deux collectifs distincts (pour
 * vérifier le cloisonnement des chiffres), des événements à plusieurs catégories
 * de places, un tarif early daté, une salle presque complète pour éprouver la
 * liste d'attente, et un événement en ligne avec du public à l'étranger.
 */

const DEMO_PASSWORD = 'nuits2026';

function daysFromNow(days: number, hour = 20, minute = 30): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  // 20 h 30 à Paris ≈ 18 h 30 UTC en heure d'été.
  d.setUTCHours(hour - 2, minute, 0, 0);
  return d;
}

async function main(): Promise<void> {
  console.log('Réinitialisation du jeu de démonstration…');

  await db.execute(sql`
    TRUNCATE organizations, users, sessions, events, ticket_types, orders,
             order_items, tickets, checkin_logs, payment_intents, payment_events,
             waitlist_entries, email_outbox, rate_limits, login_attempts, audit_log
    RESTART IDENTITY CASCADE
  `);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  /* --- Collectifs --------------------------------------------------------- */

  const [garonne] = await db
    .insert(organizations)
    .values({
      name: 'Les Nuits de la Garonne',
      slug: 'nuits-garonne',
      contactEmail: 'contact@nuitsdelagaronne.fr',
      timezone: 'Europe/Paris',
    })
    .returning();

  const [echo] = await db
    .insert(organizations)
    .values({
      name: 'Collectif Écho',
      slug: 'collectif-echo',
      contactEmail: 'bonjour@collectif-echo.fr',
      timezone: 'Europe/Paris',
    })
    .returning();

  await db.insert(users).values([
    {
      organizationId: garonne.id,
      email: 'marie@nuitsdelagaronne.fr',
      name: 'Marie Delaunay',
      role: 'owner',
      passwordHash,
    },
    {
      organizationId: garonne.id,
      email: 'entree@nuitsdelagaronne.fr',
      name: 'Équipe entrée',
      role: 'scanner',
      passwordHash,
    },
    {
      organizationId: echo.id,
      email: 'sam@collectif-echo.fr',
      name: 'Sam Ferreira',
      role: 'owner',
      passwordHash,
    },
  ]);

  /* --- Événements des Nuits de la Garonne --------------------------------- */

  const [rocher] = await db
    .insert(events)
    .values({
      organizationId: garonne.id,
      slug: 'nuit-electrique-rocher-palmer',
      title: 'Nuit Électrique — Rocher de Palmer',
      description:
        "Trois formations bordelaises pour une nuit à haute tension. Ouverture des portes à 19 h 30, premier set à 20 h 30.",
      venueName: 'Rocher de Palmer',
      venueAddress: '1 Rue Aristide Briand, 33150 Cenon',
      timezone: 'Europe/Paris',
      doorsAt: daysFromNow(21, 19, 30),
      startsAt: daysFromNow(21, 20, 30),
      endsAt: daysFromNow(22, 1, 0),
      status: 'published',
      holdMinutesCard: 15,
      holdHoursTransfer: 72,
      waitlistOfferHours: 6,
      cancellationDeadlineHours: 48,
    })
    .returning();

  await db.insert(ticketTypes).values([
    {
      eventId: rocher.id,
      name: 'Fosse',
      description: 'Debout, devant la scène.',
      position: 0,
      priceCents: 2200,
      earlyPriceCents: 1600,
      earlyEndsAt: daysFromNow(7),
      quantityTotal: 380,
      maxPerOrder: 6,
    },
    {
      eventId: rocher.id,
      name: 'Balcon',
      description: 'Places assises numérotées.',
      position: 1,
      priceCents: 2800,
      quantityTotal: 120,
      maxPerOrder: 4,
    },
  ]);

  // Concert volontairement presque complet : sert à éprouver la liste d'attente
  // et le message « il ne reste que N places ».
  const [caillou] = await db
    .insert(events)
    .values({
      organizationId: garonne.id,
      slug: 'session-acoustique-caillou',
      title: 'Session acoustique — Le Caillou',
      description: 'Format intimiste, jauge réduite. Une seule date.',
      venueName: 'Le Caillou du Jardin Botanique',
      venueAddress: 'Esplanade Linné, 33100 Bordeaux',
      timezone: 'Europe/Paris',
      doorsAt: daysFromNow(10, 19, 0),
      startsAt: daysFromNow(10, 20, 0),
      status: 'published',
      holdMinutesCard: 10,
      holdHoursTransfer: 48,
      waitlistOfferHours: 4,
      cancellationDeadlineHours: 24,
    })
    .returning();

  await db.insert(ticketTypes).values([
    {
      eventId: caillou.id,
      name: 'Standard',
      position: 0,
      priceCents: 1400,
      quantityTotal: 80,
      // 77 places déjà prises : il n'en reste que 3.
      quantityReserved: 77,
      quantitySold: 77,
      maxPerOrder: 4,
    },
  ]);

  const [brouillon] = await db
    .insert(events)
    .values({
      organizationId: garonne.id,
      slug: 'nuit-de-printemps-darwin',
      title: 'Nuit de Printemps — Darwin',
      description: 'En préparation. Programmation à confirmer.',
      venueName: 'Darwin Écosystème',
      venueAddress: '87 Quai des Queyries, 33100 Bordeaux',
      timezone: 'Europe/Paris',
      startsAt: daysFromNow(60, 21, 0),
      status: 'draft',
    })
    .returning();

  await db.insert(ticketTypes).values([
    { eventId: brouillon.id, name: 'Prévente', position: 0, priceCents: 1800, quantityTotal: 600 },
  ]);

  /* --- Événement du collectif partenaire ---------------------------------- */

  // Public à l'étranger : c'est le cas qui impose l'affichage explicite des
  // fuseaux horaires.
  const [enLigne] = await db
    .insert(events)
    .values({
      organizationId: echo.id,
      slug: 'echo-live-en-ligne',
      title: 'Écho Live — diffusion en ligne',
      description:
        "Concert diffusé en direct. Le lien de connexion est envoyé une heure avant le début.",
      isOnline: true,
      onlineUrl: 'https://live.collectif-echo.fr/session',
      timezone: 'Europe/Paris',
      startsAt: daysFromNow(14, 21, 0),
      status: 'published',
      holdMinutesCard: 20,
      holdHoursTransfer: 72,
      cancellationDeadlineHours: 12,
    })
    .returning();

  await db.insert(ticketTypes).values([
    { eventId: enLigne.id, name: 'Accès standard', position: 0, priceCents: 800, quantityTotal: 300 },
    {
      eventId: enLigne.id,
      name: 'Soutien',
      description: 'Même accès, contribution libre au collectif.',
      position: 1,
      priceCents: 2000,
      quantityTotal: 100,
    },
  ]);

  console.log(`
Jeu de démonstration prêt.

  Connexion admin — http://localhost:3000/admin
    Les Nuits de la Garonne : marie@nuitsdelagaronne.fr / ${DEMO_PASSWORD}
    Poste d'entrée         : entree@nuitsdelagaronne.fr / ${DEMO_PASSWORD}
    Collectif Écho         : sam@collectif-echo.fr / ${DEMO_PASSWORD}

  Chaque compte ne voit que les événements de son collectif.
`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Échec du jeu de démonstration :', err);
  process.exit(1);
});
