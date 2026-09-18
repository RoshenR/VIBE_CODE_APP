import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { ticketTypes, waitlistEntries } from '@/db/schema';
import { requireEvent } from '@/lib/org';
import { formatShort } from '@/lib/dates';
import { Badge } from '@/app/_components/chrome';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' }> = {
  waiting: { label: 'En attente', tone: 'neutral' },
  offered: { label: 'Offre en cours', tone: 'warn' },
  converted: { label: 'A pris sa place', tone: 'ok' },
  expired: { label: 'Sans réponse', tone: 'danger' },
  cancelled: { label: 'Désinscrit', tone: 'danger' },
};

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
    .select({
      entry: waitlistEntries,
      ticketTypeName: ticketTypes.name,
    })
    .from(waitlistEntries)
    .leftJoin(ticketTypes, eq(ticketTypes.id, waitlistEntries.ticketTypeId))
    .where(eq(waitlistEntries.eventId, id))
    .orderBy(asc(waitlistEntries.position));

  const active = entries.filter(
    (e) => e.entry.status === 'waiting' || e.entry.status === 'offered',
  );

  return (
    <div>
      <Link
        href={`/admin/evenements/${id}`}
        className="text-ink-500 hover:text-ink-800 text-sm"
      >
        ← {event.title}
      </Link>
      <h1 className="text-ink-900 mt-1 text-xl font-semibold tracking-tight">
        Liste d&apos;attente
      </h1>
      <p className="text-ink-500 mt-1 text-sm">
        {active.length} personne{active.length > 1 ? 's' : ''} en attente. Les places
        libérées sont proposées automatiquement, dans cet ordre, avec{' '}
        {event.waitlistOfferHours} h pour répondre.
      </p>

      {entries.length === 0 ? (
        <p className="border-ink-200 text-ink-500 mt-6 rounded-2xl border border-dashed px-6 py-12 text-center text-sm">
          Personne sur la liste d&apos;attente.
        </p>
      ) : (
        <ol className="mt-6 space-y-2">
          {entries.map(({ entry, ticketTypeName }) => {
            const status = STATUS[entry.status] ?? {
              label: entry.status,
              tone: 'neutral' as const,
            };

            return (
              <li
                key={entry.id}
                className="border-ink-200 flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-white p-4"
              >
                <div className="flex min-w-0 gap-3">
                  <span className="bg-ink-100 text-ink-600 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums">
                    {entry.position}
                  </span>
                  <div className="min-w-0">
                    <p className="text-ink-900 font-medium">{entry.name}</p>
                    <p className="text-ink-500 truncate text-sm">{entry.email}</p>
                    <p className="text-ink-400 mt-0.5 text-xs">
                      {entry.quantity} place{entry.quantity > 1 ? 's' : ''} ·{' '}
                      {ticketTypeName ?? 'peu importe la catégorie'}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {entry.status === 'offered' && entry.offerExpiresAt && (
                    <p className="text-ink-400 mt-1 text-xs">
                      réponse avant {formatShort(entry.offerExpiresAt, event.timezone)}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
