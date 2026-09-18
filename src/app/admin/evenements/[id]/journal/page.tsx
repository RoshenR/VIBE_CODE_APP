import Link from 'next/link';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, users } from '@/db/schema';
import { requireEvent } from '@/lib/org';
import { formatShort } from '@/lib/dates';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Journal des actions' };

/**
 * Journal des actions sur un événement.
 *
 * Utilité concrète : quand un client affirme ne pas avoir annulé sa commande, ou
 * qu'une jauge se retrouve à un nombre que personne ne reconnaît, cette page
 * donne un fait — qui, quoi, quand — au lieu d'une discussion.
 *
 * Le journal est en ajout seul : aucune page, aucune action ne permet de le
 * modifier ou de l'effacer. Une trace qu'on peut réécrire ne prouve rien.
 */

const LABELS: Record<string, string> = {
  'evenement.cree': 'Événement créé',
  'evenement.modifie': 'Réglages modifiés',
  'evenement.publie': 'Mise en vente',
  'evenement.suspendu': 'Vente suspendue',
  'categorie.creee': 'Catégorie ajoutée',
  'categorie.modifiee': 'Catégorie modifiée',
  'categorie.supprimee': 'Catégorie supprimée',
  'commande.annulee': 'Commande annulée',
  'commande.remboursee': 'Commande remboursée',
  'export.participants': 'Liste des participants exportée',
  'billets.manifeste_telecharge': "Liste des billets chargée sur un appareil d'entrée",
};

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, event } = await requireEvent(id);

  /*
   * Le filtre porte sur l'organisation *et* sur l'événement. L'organisation
   * seule ne suffirait pas — elle laisserait voir les actions des autres dates ;
   * l'événement seul non plus — un identifiant deviné donnerait accès au journal
   * d'un autre collectif.
   */
  const entries = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
      ipPrefix: auditLog.ipPrefix,
      userName: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(
      and(
        eq(auditLog.organizationId, user.organizationId),
        or(
          eq(auditLog.targetId, id),
          sql`${auditLog.metadata} ->> 'evenement' = ${id}`,
        ),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(200);

  return (
    <div>
      <Link
        href={`/admin/evenements/${id}`}
        className="text-ink-500 hover:text-ink-800 text-sm"
      >
        ← {event.title}
      </Link>
      <h1 className="text-ink-900 mt-1 text-xl font-semibold tracking-tight">
        Journal des actions
      </h1>
      <p className="text-ink-500 mt-1 max-w-prose text-sm">
        Toutes les actions sensibles sur cet événement, du plus récent au plus
        ancien. Ce journal ne peut être ni modifié ni effacé depuis
        l&apos;application.
      </p>

      {entries.length === 0 ? (
        <p className="border-ink-200 text-ink-500 mt-6 rounded-2xl border border-dashed px-6 py-12 text-center text-sm">
          Aucune action enregistrée pour le moment.
        </p>
      ) : (
        <ol className="mt-6 space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="border-ink-200 flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-white px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-ink-900 text-sm font-medium">
                  {LABELS[entry.action] ?? entry.action}
                </p>
                <p className="text-ink-500 mt-0.5 text-sm">
                  {entry.userName ?? 'Action automatique ou publique'}
                  {entry.ipPrefix && (
                    <span className="text-ink-400"> · depuis {entry.ipPrefix}</span>
                  )}
                </p>
                <Details metadata={entry.metadata as Record<string, unknown>} />
              </div>
              <time className="text-ink-400 shrink-0 text-xs">
                {formatShort(entry.createdAt, event.timezone)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Affiche les détails utiles d'une entrée, sans jargon technique. */
function Details({ metadata }: { metadata: Record<string, unknown> }) {
  const parts: string[] = [];

  if (typeof metadata.reference === 'string') parts.push(`commande ${metadata.reference}`);
  if (typeof metadata.nom === 'string') parts.push(`« ${metadata.nom} »`);
  if (typeof metadata.jauge === 'number') parts.push(`jauge ${metadata.jauge}`);
  if (typeof metadata.lignes === 'number') parts.push(`${metadata.lignes} ligne(s)`);
  if (typeof metadata.billets === 'number') parts.push(`${metadata.billets} billet(s)`);
  if (typeof metadata.montant_centimes === 'number') {
    parts.push(
      new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(
        metadata.montant_centimes / 100,
      ),
    );
  }

  if (parts.length === 0) return null;

  return <p className="text-ink-400 mt-0.5 text-xs">{parts.join(' · ')}</p>;
}
