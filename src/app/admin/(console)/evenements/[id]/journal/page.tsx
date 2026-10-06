import type { Metadata } from 'next';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { ScrollText } from 'lucide-react';
import { db } from '@/db';
import { auditLog, users } from '@/db/schema';
import { EmptyState } from '@/components/ui/states';
import { formatShort } from '@/lib/dates';
import { requireEvent } from '@/lib/org';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Journal des actions' };

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
  'commande.remboursee': 'Commande annulée — remboursement enregistré',
  'export.participants': 'Liste des participants exportée',
  'billets.manifeste_telecharge': "Liste des billets chargée sur un appareil d'entrée",
};

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, event } = await requireEvent(id);

  /*
   * Le filtre porte sur l'organisation ET sur l'événement. L'organisation seule
   * laisserait voir les actions des autres dates ; l'événement seul donnerait,
   * pour un identifiant deviné, accès au journal d'un autre collectif.
   */
  const entries = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
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
        or(eq(auditLog.targetId, id), sql`${auditLog.metadata} ->> 'evenement' = ${id}`),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(200);

  return (
    <div>
      <h2 className="display text-display-md">Journal des actions</h2>
      <p className="text-ink-soft measure mt-2">
        Les actions sensibles sur cet événement, de la plus récente à la plus ancienne. Ce journal ne
        peut être ni modifié ni effacé depuis l&apos;application.
      </p>

      {entries.length === 0 ? (
        <div className="mt-8">
          <EmptyState icon={ScrollText} title="Aucune action enregistrée">
            Les modifications de réglages, annulations et exports apparaîtront ici avec leur auteur.
          </EmptyState>
        </div>
      ) : (
        <div className="border-rule bg-paper shadow-panel mt-6 overflow-hidden rounded-panel border">
          <table className="data-table">
            <caption className="sr-only">Journal des actions de l&apos;événement</caption>
            <thead>
              <tr>
                <th scope="col">Quand</th>
                <th scope="col">Action</th>
                <th scope="col" className="hidden sm:table-cell">
                  Par
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="text-ink-soft w-44 text-sm tabular-nums whitespace-nowrap">
                    {formatShort(entry.createdAt, event.timezone)}
                  </td>
                  <td>
                    <span className="font-medium">{LABELS[entry.action] ?? entry.action}</span>
                    <Details metadata={entry.metadata as Record<string, unknown>} />
                    <span className="text-ink-muted mt-0.5 block text-sm sm:hidden">
                      {entry.userName ?? 'Action automatique ou publique'}
                    </span>
                  </td>
                  <td className="hidden sm:table-cell">
                    {entry.userName ?? (
                      <span className="text-ink-muted">Automatique ou publique</span>
                    )}
                    {entry.ipPrefix && (
                      <span className="text-ink-muted block text-xs">depuis {entry.ipPrefix}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Détails utiles d'une entrée, sans jargon technique. */
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
  return <span className="text-ink-muted mt-0.5 block text-sm">{parts.join(' · ')}</span>;
}
