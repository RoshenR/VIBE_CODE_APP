import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { events } from '@/db/schema';
import { getCurrentUser, type SessionUser } from './auth';
import { can, type Permission } from './permissions';
import { isSameOrigin } from './security/request';

/**
 * Contrôle d'accès pour les routes d'API.
 *
 * Distinct de `org.ts`, qui redirige ou renvoie 404 — inadapté à un `fetch`.
 * Le principe reste identique : organisation et droits viennent de la session,
 * jamais du corps de la requête.
 */

export type ApiAuthResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

export async function requireApiUser(permission?: Permission): Promise<ApiAuthResult<SessionUser>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, error: 'Authentification requise.' };

  if (permission && !can(user, permission)) {
    return { ok: false, status: 404, error: 'Ressource introuvable.' };
  }

  return { ok: true, data: user };
}

/**
 * Charge un événement en vérifiant appartenance **et** droit.
 *
 * 404 plutôt que 403 pour un événement d'un autre collectif : confirmer
 * l'existence d'un identifiant est déjà une fuite d'information.
 */
export async function requireApiEvent(
  eventId: string,
  permission: Permission = 'billets.scanner',
): Promise<ApiAuthResult<{ user: SessionUser; event: typeof events.$inferSelect }>> {
  const auth = await requireApiUser(permission);
  if (!auth.ok) return auth;

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, auth.data.organizationId)))
    .limit(1);

  if (!event) return { ok: false, status: 404, error: 'Événement introuvable.' };

  return { ok: true, data: { user: auth.data, event } };
}

/**
 * Garde d'origine pour toute route modifiant l'état.
 *
 * À appeler avant de lire le corps de la requête : une requête d'origine
 * étrangère ne mérite pas qu'on l'analyse.
 */
export function guardOrigin(request: Request): Response | null {
  if (isSameOrigin(request)) return null;

  return new Response(JSON.stringify({ error: 'Origine de la requête non autorisée.' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });
}
