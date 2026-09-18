import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { loginAttempts } from '@/db/schema';

/**
 * Verrouillage temporaire après échecs répétés.
 *
 * Complémentaire de la limitation de débit, pas redondant :
 *
 *  • la limitation plafonne le **rythme** — elle arrête une attaque rapide, mais
 *    laisse passer un attaquant patient qui tente dix mots de passe par heure ;
 *  • le verrouillage compte les **échecs consécutifs** sur une cible précise et
 *    impose une attente qui double à chaque série.
 *
 * Le délai est plafonné : un verrouillage définitif serait une arme retournée
 * contre le propriétaire du compte — il suffirait de tenter volontairement de
 * faux mots de passe pour le bloquer le soir d'un concert.
 */

const FREE_ATTEMPTS = 5;
const BASE_DELAY_SECONDS = 30;
const MAX_DELAY_SECONDS = 15 * 60;
/** Au-delà, la série est considérée terminée et le compteur repart de zéro. */
const RESET_AFTER_SECONDS = 60 * 60;

export interface LockoutState {
  locked: boolean;
  /** Secondes restantes avant de pouvoir réessayer. */
  retryAfter: number;
  failures: number;
}

export async function checkLock(identifier: string): Promise<LockoutState> {
  const [row] = await db
    .select()
    .from(loginAttempts)
    .where(eq(loginAttempts.identifier, identifier))
    .limit(1);

  if (!row?.lockedUntil) return { locked: false, retryAfter: 0, failures: row?.failures ?? 0 };

  const remaining = row.lockedUntil.getTime() - Date.now();
  if (remaining <= 0) return { locked: false, retryAfter: 0, failures: row.failures };

  return { locked: true, retryAfter: Math.ceil(remaining / 1000), failures: row.failures };
}

/**
 * Enregistre un échec et calcule le nouveau verrou.
 *
 * Tout tient dans une seule instruction : deux tentatives simultanées ne peuvent
 * pas lire le même compteur et l'écraser mutuellement — ce qui offrirait, à
 * chaque fois, un essai gratuit à qui attaque en parallèle.
 */
export async function recordFailure(identifier: string): Promise<LockoutState> {
  const result = await db.execute(sql`
    INSERT INTO login_attempts (identifier, failures, last_failure_at, locked_until)
         VALUES (${identifier}, 1, now(), NULL)
    ON CONFLICT (identifier) DO UPDATE SET
      -- Série interrompue depuis longtemps : on repart à 1.
      failures = CASE
        WHEN login_attempts.last_failure_at < now() - (${RESET_AFTER_SECONDS} || ' seconds')::interval
          THEN 1
        ELSE login_attempts.failures + 1
      END,
      last_failure_at = now(),
      locked_until = CASE
        WHEN (CASE
                WHEN login_attempts.last_failure_at < now() - (${RESET_AFTER_SECONDS} || ' seconds')::interval
                  THEN 1
                ELSE login_attempts.failures + 1
              END) > ${FREE_ATTEMPTS}
        THEN now() + (LEAST(
               ${MAX_DELAY_SECONDS},
               ${BASE_DELAY_SECONDS} * POWER(2, LEAST(10, (CASE
                 WHEN login_attempts.last_failure_at < now() - (${RESET_AFTER_SECONDS} || ' seconds')::interval
                   THEN 1
                 ELSE login_attempts.failures + 1
               END) - ${FREE_ATTEMPTS} - 1))
             ) || ' seconds')::interval
        ELSE NULL
      END
    RETURNING failures, locked_until
  `);

  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  const row = rows[0] as { failures: number; locked_until: string | null } | undefined;

  const failures = Number(row?.failures ?? 1);
  const lockedUntil = row?.locked_until ? new Date(row.locked_until) : null;
  const remaining = lockedUntil ? lockedUntil.getTime() - Date.now() : 0;

  return {
    locked: remaining > 0,
    retryAfter: Math.max(0, Math.ceil(remaining / 1000)),
    failures,
  };
}

/** Connexion réussie : la série s'arrête. */
export async function clearFailures(identifier: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.identifier, identifier));
}

/** Purge des séries anciennes, appelée par le worker. */
export async function purgeStale(): Promise<void> {
  await db.execute(
    sql`DELETE FROM login_attempts
         WHERE last_failure_at < now() - interval '7 days'
           AND (locked_until IS NULL OR locked_until < now())`,
  );
}
