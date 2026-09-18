import { sql } from 'drizzle-orm';
import { db } from '@/db';

/**
 * Limitation de débit, en fenêtre fixe, adossée à PostgreSQL.
 *
 * Pourquoi la base et non la mémoire du processus :
 *
 *  • un compteur en mémoire repart à zéro à chaque redéploiement — il suffit
 *    d'attendre une mise en production pour reprendre une attaque ;
 *  • il n'est pas partagé entre instances — deux conteneurs derrière un
 *    répartiteur doublent mécaniquement toutes les limites ;
 *  • il disparaît au redémarrage, donc ne laisse aucune trace exploitable.
 *
 * Le coût est d'un `INSERT … ON CONFLICT` par requête protégée, ce qui est sans
 * commune mesure avec ce que protège cette table.
 */

export interface RateLimitRule {
  /** Nombre d'actions tolérées par fenêtre. */
  limit: number;
  /** Durée de la fenêtre, en secondes. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Secondes à attendre avant de réessayer, quand la limite est atteinte. */
  retryAfter: number;
}

/**
 * Règles par usage.
 *
 * Elles sont volontairement différenciées : une limite unique serait soit trop
 * permissive pour la connexion, soit assez stricte pour gêner un groupe d'amis
 * qui réserve depuis le même réseau Wi-Fi.
 */
export const RULES = {
  /** Connexion : très strict, c'est la cible favorite des attaques automatisées. */
  login: { limit: 8, windowSeconds: 300 },
  /** Vérification du second facteur. */
  totp: { limit: 10, windowSeconds: 300 },
  /** Création de réservation : un humain n'en enchaîne pas quinze en cinq minutes. */
  hold: { limit: 12, windowSeconds: 300 },
  /** Inscription en liste d'attente. */
  waitlist: { limit: 6, windowSeconds: 600 },
  /** Annulation : le lien est nominatif, la limite protège du tâtonnement. */
  cancel: { limit: 10, windowSeconds: 600 },
  /** Scan à l'entrée : haut, car légitime en rafale devant une file. */
  scan: { limit: 600, windowSeconds: 60 },
  /** Synchronisation hors ligne. */
  sync: { limit: 60, windowSeconds: 60 },
  /** Notifications de paiement : large, le prestataire peut réessayer. */
  webhook: { limit: 300, windowSeconds: 60 },
  /** Consultation d'une page de gestion de commande. */
  orderView: { limit: 60, windowSeconds: 300 },
} as const satisfies Record<string, RateLimitRule>;

export type RuleName = keyof typeof RULES;

/**
 * Enregistre une tentative et indique si elle est autorisée.
 *
 * L'incrément et la lecture se font dans **une seule instruction** : deux
 * requêtes simultanées ne peuvent pas lire toutes les deux « 9 sur 10 » et
 * passer ensemble. C'est le même raisonnement que pour le stock de places.
 */
export async function consume(
  rule: RuleName,
  identifier: string,
  overrides?: Partial<RateLimitRule>,
): Promise<RateLimitResult> {
  const { limit, windowSeconds } = { ...RULES[rule], ...overrides };
  const bucket = `${rule}:${identifier}`;

  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const expiresAt = new Date(windowStart.getTime() + windowMs);

  try {
    /*
     * Les dates sont passées en ISO puis converties explicitement.
     *
     * Le pilote `postgres` ne sait pas typer un objet `Date` dans un gabarit SQL
     * brut : il tentait d'en calculer la longueur en octets et échouait. L'appel
     * partait alors dans le `catch` ci-dessous, qui laisse passer la requête —
     * autrement dit, toute la limitation de débit était inopérante sans que rien
     * ne le signale. C'est précisément le genre de panne silencieuse qu'un test
     * doit attraper.
     */
    const result = await db.execute(sql`
      INSERT INTO rate_limits (bucket, window_start, count, expires_at)
           VALUES (
             ${bucket},
             ${windowStart.toISOString()}::timestamptz,
             1,
             ${expiresAt.toISOString()}::timestamptz
           )
      ON CONFLICT (bucket, window_start)
      DO UPDATE SET count = rate_limits.count + 1
        RETURNING count
    `);

    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    const count = Number((rows[0] as { count: number } | undefined)?.count ?? 1);

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfter: Math.ceil((expiresAt.getTime() - now) / 1000),
    };
  } catch (err) {
    // La base est injoignable. Refuser tout le trafic transformerait un incident
    // de base en panne totale ; on laisse passer en le signalant bruyamment.
    // Ce choix est explicite : la disponibilité prime ici, parce que les
    // garanties qui comptent vraiment (stock, billets) sont, elles, portées par
    // la base — si elle est à terre, il n'y a de toute façon plus rien à voler.
    console.error('[sécurité] limitation de débit indisponible', err);
    return { allowed: true, remaining: 0, retryAfter: 0 };
  }
}

/**
 * Vérifie plusieurs compteurs à la fois et renvoie le plus contraignant.
 *
 * Typiquement l'adresse IP **et** l'adresse e-mail : limiter uniquement par IP
 * laisse passer une attaque distribuée, limiter uniquement par e-mail laisse
 * passer le balayage d'adresses.
 */
export async function consumeAll(
  checks: { rule: RuleName; identifier: string }[],
): Promise<RateLimitResult> {
  const results = await Promise.all(checks.map((c) => consume(c.rule, c.identifier)));

  const blocked = results.find((r) => !r.allowed);
  if (blocked) return blocked;

  return results.reduce((strictest, r) => (r.remaining < strictest.remaining ? r : strictest));
}

/** Purge des fenêtres échues, appelée par le worker. */
export async function purgeExpired(): Promise<void> {
  await db.execute(sql`DELETE FROM rate_limits WHERE expires_at < now()`);
}

/**
 * Réponse normalisée en cas de dépassement.
 *
 * `Retry-After` est renseigné : un client correct attend au lieu de marteler, et
 * l'en-tête évite de laisser croire à une panne.
 */
export function tooManyRequests(result: RateLimitResult, message?: string): Response {
  return new Response(
    JSON.stringify({
      error:
        message ??
        `Trop de tentatives. Réessayez dans ${Math.ceil(result.retryAfter / 60)} minute(s).`,
      retryAfter: result.retryAfter,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(result.retryAfter),
      },
    },
  );
}
