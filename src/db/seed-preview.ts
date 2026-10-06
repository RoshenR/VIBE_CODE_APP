import { loadEnv } from '../lib/env';
loadEnv();

import { and, eq, like } from 'drizzle-orm';
import { db } from './index';
import { events, organizations, orders, ticketTypes } from './schema';
import { zonedToUtc } from '../lib/dates';
import { cancelOrder, confirmOrder, createHold, expireOrder } from '../server/orders';

/**
 * Données de PRÉVISUALISATION de l'interface.
 *
 * Elles servent à contrôler à l'œil les états que le jeu de démonstration ne
 * couvre pas : complet, catégorie épuisée, ventes terminées, vente à venir,
 * titre très long, événement en ligne dans un autre fuseau, commande expirée…
 *
 * Elles sont ISOLÉES de tout le reste :
 *   • tous les slugs commencent par `apercu-` ;
 *   • le script refuse de tourner en production ;
 *   • `npm run db:seed:preview -- --clean` supprime tout ce qu'il a créé (les
 *     commandes, billets et inscriptions partent avec, par cascade).
 *
 *   npm run db:seed:preview            crée les données
 *   npm run db:seed:preview -- --clean les retire
 */

const PREFIX = 'apercu-';
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

function inDays(days: number, hour: number, minute: number, timezone: string): Date {
  const target = new Date(Date.now() + days * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(target);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return zonedToUtc(get('year'), get('month'), get('day'), hour, minute, timezone);
}

async function clean(): Promise<void> {
  const removed = await db.delete(events).where(like(events.slug, `${PREFIX}%`)).returning({
    slug: events.slug,
  });
  console.log(`Prévisualisation retirée : ${removed.length} événement(s).`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refus : les données de prévisualisation ne se créent jamais en production.');
    process.exit(1);
  }

  if (process.argv.includes('--clean')) {
    await clean();
    process.exit(0);
  }

  await clean(); // idempotent : on repart toujours d'un état propre

  const [garonne] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, 'nuits-garonne'))
    .limit(1);
  const [echo] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, 'collectif-echo'))
    .limit(1);

  if (!garonne || !echo) {
    console.error('Lancez d’abord `npm run db:seed` : les collectifs de démonstration sont absents.');
    process.exit(1);
  }

  const base = { status: 'published' as const, timezone: 'Europe/Paris' };

  /* 1. Complet, titre très long ------------------------------------------- */
  const [complet] = await db
    .insert(events)
    .values({
      ...base,
      organizationId: garonne.id,
      slug: `${PREFIX}complet`,
      title: 'Nuit Blanche — Les Quinconces Sound System avec orchestre et invités surprise',
      description:
        "Une nuit entière, trois scènes, de la tombée du jour au premier tram. Soirée complète : inscrivez-vous sur la liste d'attente pour être prévenu·e en cas de désistement.",
      venueName: 'Hangar 14 — Quai des Chartrons',
      venueAddress: '14 Quai des Chartrons, 33000 Bordeaux',
      doorsAt: inDays(12, 21, 0, 'Europe/Paris'),
      startsAt: inDays(12, 22, 0, 'Europe/Paris'),
    })
    .returning();
  await db.insert(ticketTypes).values([
    { eventId: complet.id, name: 'Entrée générale', priceCents: 2500, quantityTotal: 120, quantityReserved: 120, quantitySold: 120 },
    { eventId: complet.id, name: 'Entrée VIP', priceCents: 6000, quantityTotal: 20, quantityReserved: 20, quantitySold: 20 },
  ]);

  /* 2. Une catégorie épuisée, l'autre disponible --------------------------- */
  const [categorie] = await db
    .insert(events)
    .values({
      ...base,
      organizationId: garonne.id,
      slug: `${PREFIX}categorie-complete`,
      title: 'Récital au Grand Théâtre',
      description: 'Le parterre est complet ; il reste des places en balcon.',
      venueName: 'Grand Théâtre de Bordeaux',
      venueAddress: 'Place de la Comédie, 33000 Bordeaux',
      doorsAt: inDays(20, 19, 0, 'Europe/Paris'),
      startsAt: inDays(20, 20, 0, 'Europe/Paris'),
    })
    .returning();
  await db.insert(ticketTypes).values([
    { eventId: categorie.id, name: 'Parterre', position: 0, priceCents: 4500, quantityTotal: 60, quantityReserved: 60, quantitySold: 60 },
    { eventId: categorie.id, name: 'Balcon', position: 1, priceCents: 3200, quantityTotal: 80, quantityReserved: 12, quantitySold: 12 },
  ]);

  /* 3. Ventes terminées ------------------------------------------------------ */
  const [terminees] = await db
    .insert(events)
    .values({
      ...base,
      organizationId: garonne.id,
      slug: `${PREFIX}ventes-terminees`,
      title: 'Brunch musical du dimanche',
      description: "La billetterie en ligne est close : des places restent à régler sur place.",
      venueName: 'Le Café Maritime',
      startsAt: inDays(3, 11, 30, 'Europe/Paris'),
    })
    .returning();
  await db.insert(ticketTypes).values([
    {
      eventId: terminees.id,
      name: 'Brunch + concert',
      priceCents: 2200,
      quantityTotal: 50,
      quantityReserved: 31,
      quantitySold: 31,
      salesEndAt: new Date(Date.now() - 86_400_000),
    },
  ]);

  /* 4. Vente à venir ----------------------------------------------------------- */
  const [bientot] = await db
    .insert(events)
    .values({
      ...base,
      organizationId: garonne.id,
      slug: `${PREFIX}bientot`,
      title: 'Festival des Quais — soirée de clôture',
      description: 'Les places seront ouvertes à la vente prochainement.',
      venueName: 'Quais de Bacalan',
      startsAt: inDays(45, 19, 30, 'Europe/Paris'),
    })
    .returning();
  await db.insert(ticketTypes).values([
    {
      eventId: bientot.id,
      name: 'Pass soirée',
      priceCents: 1900,
      earlyPriceCents: 1500,
      earlyEndsAt: inDays(12, 23, 59, 'Europe/Paris'),
      quantityTotal: 400,
      salesStartAt: inDays(5, 10, 0, 'Europe/Paris'),
    },
  ]);

  /* 5. En ligne, depuis Montréal -------------------------------------------- */
  const [montreal] = await db
    .insert(events)
    .values({
      ...base,
      organizationId: echo.id,
      slug: `${PREFIX}montreal`,
      title: 'Concert transatlantique — Bordeaux × Montréal',
      description:
        "Diffusion simultanée depuis Montréal.\n\nLe lien de connexion est envoyé avant le début.",
      isOnline: true,
      onlineUrl: 'https://live.example.test/transatlantique',
      timezone: 'America/Montreal',
      startsAt: inDays(9, 20, 0, 'America/Montreal'),
    })
    .returning();
  await db.insert(ticketTypes).values([
    { eventId: montreal.id, name: 'Accès en direct', priceCents: 900, quantityTotal: 500 },
  ]);

  /* 6. Sans description, sans portes --------------------------------------- */
  const [sobre] = await db
    .insert(events)
    .values({
      ...base,
      organizationId: echo.id,
      slug: `${PREFIX}sobre`,
      title: 'Jam',
      description: '',
      venueName: 'La Rock School Barbey',
      startsAt: inDays(6, 21, 0, 'Europe/Paris'),
    })
    .returning();
  await db.insert(ticketTypes).values([
    { eventId: sobre.id, name: 'Entrée', priceCents: 0, quantityTotal: 90 },
  ]);

  /* --- Commandes dans tous leurs états, sur l'événement « catégorie » ------- */
  const customer = (name: string) => ({
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@apercu.example.test`,
    timezone: 'Europe/Paris',
  });
  const [balcon] = await db
    .select()
    .from(ticketTypes)
    .where(and(eq(ticketTypes.eventId, categorie.id), eq(ticketTypes.name, 'Balcon')))
    .limit(1);

  const make = async (name: string, quantity: number) =>
    (
      await createHold({
        eventId: categorie.id,
        lines: [{ ticketTypeId: balcon.id, quantity }],
        customer: customer(name),
        paymentMethod: 'card',
      })
    ).order;

  const links: [string, string][] = [];

  const payee = await make('Camille Payee', 2);
  await db.transaction((tx) => confirmOrder(tx, payee.id, { source: 'apercu' }));
  links.push(['Payée (2 billets)', payee.manageToken]);

  const attente = await make('Alex Attente', 1);
  // Échéance dans quelques minutes : permet de voir le compte à rebours vivre.
  await db
    .update(orders)
    .set({ holdExpiresAt: new Date(Date.now() + 4 * 60_000 + 30_000) })
    .where(eq(orders.id, attente.id));
  links.push(['À régler (échéance dans ~4 min)', attente.manageToken]);

  const expiree = await make('Eva Expiree', 1);
  await db.transaction((tx) => expireOrder(tx, expiree.id));
  links.push(['Expirée', expiree.manageToken]);

  const annulee = await make('Hugo Annule', 1);
  await db.transaction((tx) => cancelOrder(tx, annulee.id, 'customer'));
  links.push(['Annulée (jamais payée)', annulee.manageToken]);

  const remboursee = await make('Lena Remboursee', 1);
  await db.transaction((tx) => confirmOrder(tx, remboursee.id, { source: 'apercu' }));
  await db.transaction((tx) => cancelOrder(tx, remboursee.id, 'organizer'));
  links.push(['Remboursée', remboursee.manageToken]);

  console.log('\nPrévisualisation créée.\n');
  console.log('Événements :');
  for (const e of [complet, categorie, terminees, bientot, montreal, sobre]) {
    console.log(`  ${APP_URL}/e/${e.slug}`);
  }
  console.log('\nCommandes :');
  for (const [label, token] of links) console.log(`  ${label.padEnd(36)} ${APP_URL}/commande/${token}`);
  console.log('\nPour tout retirer : npm run db:seed:preview -- --clean');
  process.exit(0);
}

main().catch((err) => {
  console.error('Échec de la prévisualisation :', err);
  process.exit(1);
});
