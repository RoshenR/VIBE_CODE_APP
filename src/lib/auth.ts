import 'server-only';
import { cookies } from 'next/headers';
import { and, eq, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '@/db';
import { organizations, sessions, users } from '@/db/schema';
import { generateSessionToken } from './reference';
import { hashSecret } from './security/config';
import * as lockout from './security/lockout';
import * as audit from './security/audit';
import { issue, verify } from './security/signed';
import {
  generateRecoveryCodes,
  normalizeRecoveryCode,
  verifyCode,
} from './security/totp';

/**
 * Authentification de l'espace organisateur.
 *
 * Choix structurants :
 *
 *  • la base ne contient que l'**empreinte** du jeton de session — une
 *    sauvegarde égarée ne livre aucune session utilisable ;
 *  • deux échéances coexistent, absolue et par inactivité : un poste laissé
 *    ouvert en coulisses finit par se fermer seul ;
 *  • `users.sessionsValidFrom` permet de déconnecter partout en une écriture ;
 *  • les échecs répétés verrouillent temporairement la cible.
 */

/**
 * Le préfixe `__Host-` est imposé par le navigateur : cookie réservé à
 * l'origine exacte, obligatoirement `Secure`, sans `Domain`. Un sous-domaine
 * compromis ne peut donc pas le poser. Inutilisable en HTTP, donc réservé à la
 * production.
 */
const COOKIE_NAME =
  process.env.NODE_ENV === 'production' ? '__Host-ndg_session' : 'ndg_session';
const PENDING_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-ndg_2fa' : 'ndg_2fa';

/** Échéance absolue : une session ne dépasse jamais cette durée. */
const ABSOLUTE_LIFETIME_DAYS = 7;
/** Échéance par inactivité. */
const IDLE_TIMEOUT_HOURS = 12;
/** Durée de l'étape intermédiaire « mot de passe validé, code attendu ». */
const PENDING_2FA_SECONDS = 300;

/** Coût bcrypt. 12 tient environ 250 ms sur un serveur modeste — le bon compromis. */
const BCRYPT_ROUNDS = 12;

/**
 * Empreinte d'un mot de passe impossible à satisfaire.
 *
 * Utilisée quand aucun compte ne correspond, pour que la vérification coûte le
 * même temps qu'avec un compte réel. Sans cela, le temps de réponse révèle
 * quelles adresses existent.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.6y4dF3VtT3wJ5s6yV6H1rT8wJ9pQ7zK';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'staff' | 'scanner';
  organizationId: string;
  organizationName: string;
  organizationTimezone: string;
  totpEnabled: boolean;
}

export interface RequestContext {
  ipPrefix?: string | null;
  userAgent?: string | null;
}

export type SignInResult =
  | { status: 'ok'; user: SessionUser }
  | { status: 'totp_required' }
  | { status: 'locked'; retryAfter: number }
  | { status: 'invalid' };

/* -------------------------------------------------------------------------- */
/* Connexion                                                                  */
/* -------------------------------------------------------------------------- */

export async function signIn(
  email: string,
  password: string,
  context: RequestContext = {},
): Promise<SignInResult> {
  const normalized = email.toLowerCase().trim();

  const lock = await lockout.checkLock(normalized);
  if (lock.locked) {
    return { status: 'locked', retryAfter: lock.retryAfter };
  }

  const [row] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);

  // Le hachage a lieu dans tous les cas : le temps de réponse ne doit pas
  // distinguer « compte inconnu » de « mot de passe faux ».
  const passwordOk = await verifyPassword(password, row?.passwordHash ?? DUMMY_HASH);

  if (!row || !passwordOk) {
    const state = await lockout.recordFailure(normalized);

    await audit.record({
      action: state.locked ? 'connexion.verrouillage' : 'connexion.echec',
      userId: row?.id ?? null,
      organizationId: row?.organizationId ?? null,
      metadata: { email: normalized, echecs: state.failures },
      ipPrefix: context.ipPrefix,
      userAgent: context.userAgent,
    });

    return state.locked
      ? { status: 'locked', retryAfter: state.retryAfter }
      : { status: 'invalid' };
  }

  // Mot de passe correct. Si un second facteur est actif, la session n'est pas
  // encore créée : on délivre un jeton court qui n'atteste que de cette étape.
  if (row.totpSecret && row.totpEnabledAt) {
    const jar = await cookies();
    jar.set(PENDING_COOKIE, issue('2fa', { userId: row.id }, PENDING_2FA_SECONDS), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: PENDING_2FA_SECONDS,
    });
    return { status: 'totp_required' };
  }

  await lockout.clearFailures(normalized);
  const user = await establishSession(row.id, context);
  return user ? { status: 'ok', user } : { status: 'invalid' };
}

/**
 * Seconde étape : code temporaire ou code de secours.
 */
export async function completeTotp(
  submitted: string,
  context: RequestContext = {},
): Promise<SignInResult> {
  const jar = await cookies();
  const pending = jar.get(PENDING_COOKIE)?.value;
  if (!pending) return { status: 'invalid' };

  const payload = verify<{ userId: string }>('2fa', pending);
  if (!payload) return { status: 'invalid' };

  const [row] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
  if (!row?.totpSecret) return { status: 'invalid' };

  const lockKey = `totp:${row.id}`;
  const lock = await lockout.checkLock(lockKey);
  if (lock.locked) return { status: 'locked', retryAfter: lock.retryAfter };

  const cleaned = submitted.trim();
  let accepted = verifyCode(row.totpSecret, cleaned);
  let usedRecoveryCode = false;

  // Code de secours : haché en base, et consommé définitivement à l'usage.
  if (!accepted) {
    const candidate = hashSecret(normalizeRecoveryCode(cleaned));
    const stored = row.totpRecoveryCodes ?? [];

    if (stored.includes(candidate)) {
      accepted = true;
      usedRecoveryCode = true;
      await db
        .update(users)
        .set({ totpRecoveryCodes: stored.filter((c) => c !== candidate) })
        .where(eq(users.id, row.id));
    }
  }

  if (!accepted) {
    const state = await lockout.recordFailure(lockKey);
    await audit.record({
      action: 'double_facteur.echec',
      userId: row.id,
      organizationId: row.organizationId,
      metadata: { echecs: state.failures },
      ipPrefix: context.ipPrefix,
      userAgent: context.userAgent,
    });
    return state.locked
      ? { status: 'locked', retryAfter: state.retryAfter }
      : { status: 'invalid' };
  }

  await lockout.clearFailures(lockKey);
  await lockout.clearFailures(row.email);
  jar.delete(PENDING_COOKIE);

  const user = await establishSession(row.id, context, { usedRecoveryCode });
  return user ? { status: 'ok', user } : { status: 'invalid' };
}

/**
 * Crée la session et pose le cookie.
 *
 * Le jeton n'existe en clair que le temps de partir dans le cookie ; la base ne
 * reçoit que son empreinte.
 */
async function establishSession(
  userId: string,
  context: RequestContext,
  metadata: Record<string, unknown> = {},
): Promise<SessionUser | null> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + ABSOLUTE_LIFETIME_DAYS * 86_400_000);

  await db.insert(sessions).values({
    tokenHash: hashSecret(token),
    userId,
    expiresAt,
    ipPrefix: context.ipPrefix ?? null,
    userAgent: context.userAgent ?? null,
  });

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });

  const user = await loadSessionUser(userId);

  await audit.record({
    action: 'connexion.reussie',
    userId,
    organizationId: user?.organizationId ?? null,
    metadata,
    ipPrefix: context.ipPrefix,
    userAgent: context.userAgent,
  });

  return user;
}

export async function signOut(context: RequestContext = {}): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;

  if (token) {
    const hash = hashSecret(token);
    const [removed] = await db
      .delete(sessions)
      .where(eq(sessions.tokenHash, hash))
      .returning({ userId: sessions.userId });

    if (removed) {
      await audit.record({
        action: 'deconnexion',
        userId: removed.userId,
        ipPrefix: context.ipPrefix,
        userAgent: context.userAgent,
      });
    }
  }

  jar.delete(COOKIE_NAME);
  jar.delete(PENDING_COOKIE);
}

/* -------------------------------------------------------------------------- */
/* Lecture de la session courante                                             */
/* -------------------------------------------------------------------------- */

export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const hash = hashSecret(token);

  /*
   * Une seule requête porte toutes les conditions de validité :
   *   • échéance absolue non atteinte ;
   *   • activité récente (inactivité) ;
   *   • session postérieure à `sessionsValidFrom` — ce qui invalide d'un coup
   *     toutes les sessions d'un compte après un changement de mot de passe.
   */
  const [session] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hash),
        sql`${sessions.expiresAt} > now()`,
        sql`${sessions.lastSeenAt} > now() - (${IDLE_TIMEOUT_HOURS} || ' hours')::interval`,
        sql`${sessions.createdAt} >= ${users.sessionsValidFrom}`,
      ),
    )
    .limit(1);

  if (!session) return null;

  /*
   * Rafraîchissement de l'activité, au plus une fois par minute.
   *
   * Écrire à chaque requête transformerait chaque affichage de page en écriture
   * en base, pour une précision dont personne n'a besoin.
   */
  await db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(sessions.tokenHash, hash),
        sql`${sessions.lastSeenAt} < now() - interval '1 minute'`,
      ),
    );

  return loadSessionUser(session.userId);
}

async function loadSessionUser(userId: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      organizationId: users.organizationId,
      organizationName: organizations.name,
      organizationTimezone: organizations.timezone,
      totpEnabledAt: users.totpEnabledAt,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;

  const { totpEnabledAt, ...rest } = row;
  return { ...rest, totpEnabled: totpEnabledAt !== null };
}

/* -------------------------------------------------------------------------- */
/* Gestion du second facteur                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Active la double authentification après vérification d'un premier code.
 *
 * Exiger un code valide **avant** d'activer évite le scénario classique : un
 * compte verrouillé par une configuration jamais terminée, parce que le secret
 * a été enregistré mais jamais ajouté au téléphone.
 */
export async function enableTotp(
  userId: string,
  secret: string,
  submittedCode: string,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false }> {
  if (!verifyCode(secret, submittedCode)) return { ok: false };

  const recoveryCodes = generateRecoveryCodes();

  await db
    .update(users)
    .set({
      totpSecret: secret,
      totpEnabledAt: new Date(),
      totpRecoveryCodes: recoveryCodes.map((c) => hashSecret(normalizeRecoveryCode(c))),
    })
    .where(eq(users.id, userId));

  await audit.record({ action: 'double_facteur.active', userId });

  // Les codes en clair ne sont montrés qu'ici, une seule fois.
  return { ok: true, recoveryCodes };
}

export async function disableTotp(userId: string, password: string): Promise<boolean> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return false;

  // Le mot de passe est redemandé : désactiver une protection est une action
  // sensible, un onglet resté ouvert ne doit pas suffire.
  if (!(await verifyPassword(password, row.passwordHash))) return false;

  await db
    .update(users)
    .set({ totpSecret: null, totpEnabledAt: null, totpRecoveryCodes: [] })
    .where(eq(users.id, userId));

  await audit.record({ action: 'double_facteur.desactive', userId });
  return true;
}

/* -------------------------------------------------------------------------- */
/* Entretien                                                                  */
/* -------------------------------------------------------------------------- */

/** Déconnecte toutes les sessions d'un compte, y compris celle en cours. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db.update(users).set({ sessionsValidFrom: new Date() }).where(eq(users.id, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(sql`${sessions.expiresAt} < now()`);
}

/** Sessions actives d'un compte, pour la page « mes appareils ». */
export async function listSessions(userId: string) {
  return db
    .select({
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      ipPrefix: sessions.ipPrefix,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), sql`${sessions.expiresAt} > now()`))
    .orderBy(sql`${sessions.lastSeenAt} DESC`);
}
