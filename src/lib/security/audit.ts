import { auditLog } from '@/db/schema';
import { db, type Executor } from '@/db';

/**
 * Journal des actions sensibles.
 *
 * La question « qui a annulé cette commande ? » finit toujours par se poser, en
 * général quand un client conteste. Sans trace, c'est parole contre parole.
 *
 * Le journal est en **ajout seul** : aucune fonction de l'application ne le
 * modifie ni ne le supprime. Une trace qu'on peut effacer ne prouve rien.
 */

export type AuditAction =
  | 'connexion.reussie'
  | 'connexion.echec'
  | 'connexion.verrouillage'
  | 'deconnexion'
  | 'double_facteur.active'
  | 'double_facteur.desactive'
  | 'double_facteur.echec'
  | 'commande.annulee'
  | 'commande.remboursee'
  | 'evenement.cree'
  | 'evenement.modifie'
  | 'evenement.publie'
  | 'evenement.suspendu'
  | 'categorie.creee'
  | 'categorie.modifiee'
  | 'categorie.supprimee'
  | 'jauge.modifiee'
  | 'export.participants'
  | 'billets.manifeste_telecharge'
  | 'securite.origine_refusee'
  | 'securite.debit_depasse';

export interface AuditEntry {
  action: AuditAction;
  organizationId?: string | null;
  userId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ipPrefix?: string | null;
  userAgent?: string | null;
}

/**
 * Écrit une entrée.
 *
 * N'échoue jamais bruyamment : une panne d'écriture du journal ne doit pas
 * annuler l'action métier qu'elle accompagne. Le compromis est assumé et
 * documenté — on préfère une trace manquante à un remboursement impossible.
 * Passez un `executor` transactionnel quand la trace doit vivre ou mourir avec
 * l'action.
 */
export async function record(entry: AuditEntry, executor: Executor = db): Promise<void> {
  try {
    await executor.insert(auditLog).values({
      action: entry.action,
      organizationId: entry.organizationId ?? null,
      userId: entry.userId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: sanitize(entry.metadata ?? {}),
      ipPrefix: entry.ipPrefix ?? null,
      userAgent: entry.userAgent ?? null,
    });
  } catch (err) {
    console.error('[audit] écriture impossible', entry.action, err);
  }
}

/**
 * Retire les valeurs qui n'ont rien à faire dans un journal conservé longtemps.
 *
 * Un journal d'audit est lu par des personnes, exporté, parfois transmis. Y
 * laisser un mot de passe ou un jeton reviendrait à créer une seconde base de
 * secrets, moins bien protégée que la première.
 */
const FORBIDDEN_KEYS = /mot_de_passe|password|secret|token|jeton|authorization|cookie/i;

function sanitize(metadata: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_KEYS.test(key)) {
      clean[key] = '[retiré]';
      continue;
    }
    clean[key] = typeof value === 'string' ? value.slice(0, 500) : value;
  }

  return clean;
}
