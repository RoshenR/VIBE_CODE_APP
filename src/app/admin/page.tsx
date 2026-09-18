import Link from 'next/link';
import { requireUser } from '@/lib/org';
import { getOrganizationOverview } from '@/server/reporting';
import { formatCents } from '@/lib/money';
import { formatShort } from '@/lib/dates';
import { Badge } from '@/app/_components/chrome';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tableau de bord' };

const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'neutral' | 'danger' }> = {
  published: { label: 'En vente', tone: 'ok' },
  draft: { label: 'Brouillon', tone: 'neutral' },
  cancelled: { label: 'Annulé', tone: 'danger' },
  archived: { label: 'Archivé', tone: 'neutral' },
};

export default async function AdminHome() {
  const user = await requireUser();
  const events = await getOrganizationOverview(user.organizationId);

  const totalRevenue = events.reduce((sum, e) => sum + e.revenueCents, 0);
  const upcoming = events.filter((e) => e.startsAt > new Date() && e.status === 'published');

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-ink-900 text-xl font-semibold tracking-tight">
            {user.organizationName}
          </h1>
          <p className="text-ink-500 mt-1 text-sm">
            {events.length} événement{events.length > 1 ? 's' : ''} ·{' '}
            {upcoming.length} en vente · {formatCents(totalRevenue)} encaissés au total
          </p>
        </div>
        <Link
          href="/admin/evenements/nouveau"
          className="bg-ink-900 hover:bg-ink-800 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
        >
          Nouvel événement
        </Link>
      </div>

      {events.length === 0 ? (
        <div className="border-ink-200 mt-8 rounded-2xl border border-dashed px-6 py-12 text-center">
          <p className="text-ink-600 font-medium">Aucun événement</p>
          <p className="text-ink-500 mt-1 text-sm">
            Créez votre première date pour ouvrir la billetterie.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {events.map((event) => {
            const status = STATUS[event.status] ?? { label: event.status, tone: 'neutral' as const };
            const fillPercent = Math.round(event.fillRate * 100);

            return (
              <li key={event.id}>
                <Link
                  href={`/admin/evenements/${event.id}`}
                  className="border-ink-200 hover:border-ink-400 block rounded-2xl border bg-white p-5 transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-ink-900 font-semibold">{event.title}</h2>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                      <p className="text-ink-500 mt-1 text-sm">
                        {formatShort(event.startsAt, event.timezone)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-ink-900 font-semibold tabular-nums">
                        {formatCents(event.revenueCents)}
                      </p>
                      <p className="text-ink-500 text-sm tabular-nums">
                        {event.sold} / {event.capacity} places
                      </p>
                    </div>
                  </div>

                  {/* Jauge de remplissage : l'information la plus regardée avant
                      une date. */}
                  <div className="bg-ink-100 mt-4 h-2 overflow-hidden rounded-full">
                    <div
                      className={`h-full rounded-full ${
                        fillPercent >= 100 ? 'bg-rose-500' : 'bg-ink-900'
                      }`}
                      style={{ width: `${Math.min(fillPercent, 100)}%` }}
                    />
                  </div>
                  <p className="text-ink-400 mt-1.5 text-xs tabular-nums">
                    {fillPercent}% de remplissage
                    {event.reserved > event.sold &&
                      ` · ${event.reserved - event.sold} en attente de paiement`}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
