import { loadEnv } from '../lib/env';
loadEnv();

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Applique les migrations en attente.
 *
 * `max: 1` : les migrations doivent s'exécuter sur une seule connexion, dans
 * l'ordre, sans concurrence possible.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? 'postgresql://nuits:nuits@localhost:5433/nuits';
  const client = postgres(url, { max: 1 });

  console.log('Application des migrations…');
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  console.log('Base à jour.');

  await client.end();
}

main().catch((err) => {
  console.error('Échec des migrations :', err);
  process.exit(1);
});
