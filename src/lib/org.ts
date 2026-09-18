import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { events, orders } from '@/db/schema';
import { getCurrentUser, type SessionUser } from './auth';
import { can, type Permission } from './permissions';

/**
 * Cloisonnement entre collectifs, et droits par rôle.
 *
 * Règle appliquée partout : **l'organisation vient de la session serveur, jamais
 * d'un paramètre fourni par le client.** Un `?org=` dans l'URL n'a aucun effet.
 */

/* -------------------------------------------------------------------------- */
/* Rôles                                                                      */
/* -------------------------------------------------------------------------- */

// La matrice vit dans un module pur, testable sans framework ni base.
export { PERMISSIONS, can } from './permissions';
export type { Permission, Role } from './permissions';

/* -------------------------------------------------------------------------- */
/* Gardes                                                                     */
/* -------------------------------------------------------------------------- */

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/connexion');
  return user;
}

/**
 * Exige une permission précise.
 *
 * Renvoie 404 plutôt que 403 : afficher « accès refusé » confirme l'existence de
 * la ressource et renseigne sur la structure des droits.
 */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, permission)) notFound();
  return user;
}

/**
 * Charge un événement du collectif connecté, en vérifiant une permission.
 */
export async function requireEvent(eventId: string, permission: Permission = 'chiffres.lire') {
  const user = await requirePermission(permission);

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, user.organizationId)))
    .limit(1);

  if (!event) notFound();
  return { user, event };
}

export async function requireOrder(orderId: string, permission: Permission = 'chiffres.lire') {
  const user = await requirePermission(permission);

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.organizationId, user.organizationId)))
    .limit(1);

  if (!order) notFound();
  return { user, order };
}

export async function requireOwner(): Promise<SessionUser> {
  return requirePermission('compte.gerer');
}
