import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireEvent } from '@/lib/org';
import { getEventStats, getSalesTimeline } from '@/server/reporting';
import { formatCents } from '@/lib/money';
import { formatDateTime, zoneLabel } from '@/lib/dates';
import { Badge } from '@/app/_components/chrome';
import { LiveRefresh } from './live-refresh';
import { SalesChart } from './sales-chart';

export const dynamic = 'force-dynamic';

/**
 * Tableau de bord d'un événement.
 *
 * Répond directement à « on ne sait jamais en temps réel combien on a vendu, ni
 * combien on a encaissé par type de place ».
 */
export default async function EventDashboard({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user, event } = await requireEvent(id);
  const stats = await getEventStats(user.organizationId, id);
  if (!stats) notFound();

  const timeline = await getSalesTimeline(user.organizationId, id);

  const eventPassed = event.startsAt < new Date();

  return (
    <div>
      <LiveRefresh intervalMs={20_000} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin" className="text-ink-500 hover:text-ink-800 text-sm">
            ← Tous les événements
          </Link>
          <h1 className="text-ink-900 mt-1 text-xl font-semibold tracking-tight">
            {event.title}
          </h1>
          <p className="text-ink-500 mt-1 text-sm">
            {formatDateTime(event.startsAt, event.timezone)}{' '}
            <span className="text-ink-400">({zoneLabel(event.startsAt, event.timezone)})</span>
          </p>
        </div>
        <Badge tone={event.status === 'published' ? 'ok' : 'neutral'}>
          {event.status === 'published' ? 'En vente' : 'Brouillon'}
        </Badge>
      </div>

      {/* Chiffres clés */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Encaissé" value={formatCents(stats.revenueCents)} emphasis />
        <Stat label="Places vendues" value={`${stats.sold} / ${stats.capacity}`} />
        <Stat
          label="En attente de paiement"
          value={String(stats.held)}
          hint={stats.pendingCents > 0 ? formatCents(stats.pendingCents) : undefined}
        />
        <Stat label="Liste d'attente" value={String(stats.waitingListSize)} />
      </div>

      {/* Rythme des ventes : la pente compte plus que le total. */}
      <section className="mt-8">
        <h2 className="text-ink-900 font-semibold">Rythme des ventes</h2>
        <div className="mt-3">
          <SalesChart points={timeline} capacity={stats.capacity} />
        </div>
      </section>

      {/* Détail par catégorie — la ventilation qui manquait au client. */}
      <section className="mt-8">
        <h2 className="text-ink-900 font-semibold">Par catégorie de place</h2>
        <div className="border-ink-200 mt-3 overflow-hidden rounded-2xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-100 text-ink-600">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Catégorie</th>
                <th className="px-4 py-2.5 text-right font-medium">Vendues</th>
                <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">
                  En attente
                </th>
                <th className="px-4 py-2.5 text-right font-medium">Restantes</th>
                <th className="px-4 py-2.5 text-right font-medium">Encaissé</th>
              </tr>
            </thead>
            <tbody className="divide-ink-200 divide-y">
              {stats.byTicketType.map((type) => (
                <tr key={type.id}>
                  <td className="px-4 py-3">
                    <span className="text-ink-900 font-medium">{type.name}</span>
                    <span className="text-ink-400 ml-2 text-xs">
                      {formatCents(type.priceCents)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {type.sold} / {type.total}
                  </td>
                  <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                    {type.held > 0 ? type.held : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {type.available === 0 ? (
                      <span className="font-medium text-rose-600">Complet</span>
                    ) : (
                      type.available
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {formatCents(type.revenueCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Entrées : visible en direct pendant la soirée. */}
      {stats.sold > 0 && (
        <section className="mt-8">
          <h2 className="text-ink-900 font-semibold">Entrées</h2>
          <div className="border-ink-200 mt-3 rounded-2xl border bg-white p-5">
            <p className="text-2xl font-semibold tabular-nums">
              {stats.checkedIn}
              <span className="text-ink-400 text-base font-normal"> / {stats.sold}</span>
            </p>
            <div className="bg-ink-100 mt-3 h-2 overflow-hidden rounded-full">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{
                  width: `${stats.sold > 0 ? Math.round((stats.checkedIn / stats.sold) * 100) : 0}%`,
                }}
              />
            </div>
            <p className="text-ink-500 mt-2 text-sm">
              {stats.sold - stats.checkedIn} personne
              {stats.sold - stats.checkedIn > 1 ? 's' : ''} pas encore arrivée
              {stats.sold - stats.checkedIn > 1 ? 's' : ''}.
            </p>
          </div>
        </section>
      )}

      <nav className="mt-8 grid gap-3 sm:grid-cols-2">
        <ActionCard
          href={`/admin/controle/${event.id}`}
          title="Contrôle à l'entrée"
          detail="Scanner les billets. Fonctionne sans réseau une fois la liste chargée."
          highlight={!eventPassed}
        />
        <ActionCard
          href={`/admin/evenements/${event.id}/commandes`}
          title="Commandes"
          detail="Consulter, rechercher, annuler et rembourser."
        />
        <ActionCard
          href={`/admin/evenements/${event.id}/liste-attente`}
          title="Liste d'attente"
          detail={`${stats.waitingListSize} personne${stats.waitingListSize > 1 ? 's' : ''} en attente.`}
        />
        <ActionCard
          href={`/admin/evenements/${event.id}/export`}
          title="Export participants"
          detail="Fichier CSV à transmettre au lieu."
        />
        <ActionCard
          href={`/admin/evenements/${event.id}/reglages`}
          title="Réglages"
          detail="Catégories de places, tarifs, jauges, délais, mise en vente."
        />
        <ActionCard
          href={`/admin/evenements/${event.id}/liste-papier`}
          title="Liste papier de secours"
          detail="À imprimer avant les portes. Fonctionne quand plus rien d'autre ne fonctionne."
        />
        <ActionCard
          href={`/admin/evenements/${event.id}/journal`}
          title="Journal des actions"
          detail="Qui a annulé, modifié une jauge, exporté la liste — et quand."
        />
      </nav>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        emphasis ? 'border-ink-900 bg-ink-900 text-ink-50' : 'border-ink-200 bg-white'
      }`}
    >
      <p className={`text-xs ${emphasis ? 'text-ink-300' : 'text-ink-500'}`}>{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint && (
        <p className={`text-xs ${emphasis ? 'text-ink-400' : 'text-ink-400'}`}>{hint}</p>
      )}
    </div>
  );
}

function ActionCard({
  href,
  title,
  detail,
  highlight,
}: {
  href: string;
  title: string;
  detail: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block rounded-2xl border p-5 transition-colors ${
        highlight
          ? 'border-copper-500 bg-copper-400/10 hover:border-copper-600'
          : 'border-ink-200 bg-white hover:border-ink-400'
      }`}
    >
      <h3 className="text-ink-900 font-medium">{title}</h3>
      <p className="text-ink-500 mt-1 text-sm">{detail}</p>
    </Link>
  );
}
