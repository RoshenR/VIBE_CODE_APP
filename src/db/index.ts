import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://nuits:nuits@localhost:5433/nuits';

/**
 * Chiffrement de la liaison avec PostgreSQL.
 *
 * En production, la base est souvent sur une autre machine : sans TLS, les
 * requêtes — donc les coordonnées des clients et les jetons — circulent en
 * clair sur le réseau.
 *
 * `DATABASE_SSL=require` accepte un certificat auto-signé, ce qui reste très
 * supérieur au clair. `strict` exige un certificat vérifiable et devrait être
 * la cible dès que l'infrastructure le permet.
 */
function sslConfig(): postgres.Options<{}>['ssl'] {
  switch (process.env.DATABASE_SSL) {
    case 'strict':
      return 'verify-full';
    case 'require':
      return { rejectUnauthorized: false };
    default:
      return undefined;
  }
}

/**
 * En développement, Next.js recharge les modules à chaque édition. Sans ce cache
 * global, chaque rechargement ouvrirait un nouveau pool de connexions jusqu'à
 * saturer PostgreSQL.
 */
const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

export const sql =
  globalForDb.__sql ??
  postgres(connectionString, {
    max: 20,
    ssl: sslConfig(),
    // Délai de connexion borné : sans plafond, une base injoignable fait
    // s'accumuler les requêtes en attente jusqu'à épuiser le serveur web.
    connect_timeout: 10,
    // Les messages d'erreur du pilote peuvent contenir les paramètres de la
    // requête — donc des données personnelles. On ne les journalise pas.
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== 'production') globalForDb.__sql = sql;

export const db = drizzle(sql, { schema });

export type Database = typeof db;
/** Type d'une transaction, pour les fonctions qui acceptent l'un ou l'autre. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Accepte indifféremment la connexion principale ou une transaction en cours. */
export type Executor = Database | Tx;

export * as schema from './schema';
