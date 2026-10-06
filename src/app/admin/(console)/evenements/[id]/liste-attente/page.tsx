import type { Metadata } from 'next';
import { asc, eq } from 'drizzle-orm';
import { CircleCheck, CircleX, Clock, Hourglass, ListOrdered, UserMinus } from 'lucide-react';
import { db } from '@/db';
import { ticketTypes, waitlistEntries } from '@/db/schema';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/states';
import { formatShort } from '@/lib/dates';
import { requireEvent } from '@/lib/org';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: "Liste d'attente" };

/**
 * Liste d'attente d'un événement.
 *
 * L'ordre affiché est l'ordre réel de traitement : c'est la promesse faite aux
 * gens, elle doit être vérifiable d'un coup d'œil.
 */
export default async function WaitlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event } = await requireEvent(id);

  const entries = await db
    .select({ entry: waitlistEntries, ticketTypeName: ticketTypes.name })
    .from(waitlistEntries)
    .leftJoin(ticketTypes, eq(ticketTypes.id, waitlistEntries.ticketTypeId))
    .where(eq(waitlistEntries.eventId, id))
    .orderBy(asc(waitlistEntries.position));

  const active = entries.filter((e) => e.entry.status === 'waiting' || e.entry.status === 'offered');

  return (
    <div>
      <h2 className="display text-display-md">Liste d&apos;attente</h2>
      <p className="text-ink-soft measure mt-2">
        {active.length} personne{active.length > 1 ? 's' : ''} en attente. Quand une place se libère,
        elle est proposée automatiquement dans cet ordre, avec{' '}
        <strong>{event.waitlistOfferHours} h</strong> pour répondre. Pendant ce délai, les places sont
        réellement réservées pour la personne.
      </p>

      {entries.length === 0 ? (
        <div className="mt-8">
          <EmptyState icon={ListOrdered} title="Personne sur la liste d'attente">
            Quand une catégorie sera complète, les visiteurs pourront s&apos;y inscrire depuis la
            page de l&apos;événement.
          </EmptyState>
        </div>
      ) : (
        <>
          {/* Ordinateur : tableau. */}
          <div className="border-rule bg-paper shadow-panel mt-6 hidden overflow-hidden rounded-panel border md:block">
            <table className="data-table">
              <caption className="sr-only">Liste d&apos;attente dans l&apos;ordre de traitement</caption>
              <thead>
                <tr>
                  <th scope="col" className="num">
                    Rang
                  </th>
                  <th scope="col">Personne</th>
                  <th scope="col">Demande</th>
                  <th scope="col">Statut</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(({ entry, ticketTypeName }) => (
                  <tr key={entry.id}>
                    <th scope="row" className="num w-20 text-lg tabular-nums">
                      {entry.position}
                    </th>
                    <td>
                      <span className="block font-medium">{entry.name}</span>
                      <span className="text-ink-muted block text-sm">{entry.email}</span>
                    </td>
                    <td className="text-[0.9375rem]">
                      {entry.quantity} place{entry.quantity > 1 ? 's' : ''}
                      <span className="text-ink-muted block text-sm">
                        {ticketTypeName ?? 'peu importe la catégorie'}
                      </span>
                    </td>
                    <td>
                      <WaitStatus status={entry.status} />
                      {entry.status === 'offered' && entry.offerExpiresAt && (
                        <span className="text-ink-muted mt-1 block text-xs">
                          réponse avant {formatShort(entry.offerExpiresAt, event.timezone)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile : une ligne par personne. */}
          <ol className="mt-6 space-y-3 md:hidden">
            {entries.map(({ entry, ticketTypeName }) => (
              <li key={entry.id} className="border-rule bg-paper shadow-panel flex gap-4 rounded-panel border p-4">
                <span className="display text-display-md w-10 shrink-0 text-center tabular-nums" aria-label={`Rang ${entry.position}`}>
                  {entry.position}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{entry.name}</p>
                  <p className="text-ink-muted truncate text-sm">{entry.email}</p>
                  <p className="text-ink-soft mt-1 text-sm">
                    {entry.quantity} place{entry.quantity > 1 ? 's' : ''} ·{' '}
                    {ticketTypeName ?? 'peu importe la catégorie'}
                  </p>
                  <div className="mt-2">
                    <WaitStatus status={entry.status} />
                  </div>
                  {entry.status === 'offered' && entry.offerExpiresAt && (
                    <p className="text-ink-muted mt-1 text-xs">
                      réponse avant {formatShort(entry.offerExpiresAt, event.timezone)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function WaitStatus({ status }: { status: string }) {
  switch (status) {
    case 'waiting':
      return (
        <StatusBadge tone="neutral" icon={Hourglass}>
          En attente
        </StatusBadge>
      );
    case 'offered':
      return (
        <StatusBadge tone="warning" icon={Clock}>
          Offre en cours
        </StatusBadge>
      );
    case 'converted':
      return (
        <StatusBadge tone="success" icon={CircleCheck}>
          A pris sa place
        </StatusBadge>
      );
    case 'expired':
      return (
        <StatusBadge tone="danger" icon={CircleX}>
          Sans réponse
        </StatusBadge>
      );
    default:
      return (
        <StatusBadge tone="neutral" icon={UserMinus}>
          Désinscrit·e
        </StatusBadge>
      );
  }
}
