import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { FillMeter } from '@/components/admin/fill-meter';
import { Stat } from '@/components/ui/stat';
import { formatClock, zoneCity } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { requireEvent } from '@/lib/org';
import { getEventStats, getSalesTimeline } from '@/server/reporting';
import { LiveRefresh } from './live-refresh';
import { SalesChart } from './sales-chart';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: "Vue d'ensemble" };

/**
 * Vue d'ensemble d'un événement.
 *
 * Répond à « combien a-t-on vendu, combien a-t-on encaissé, par type de place ».
 * Les notions voisines restent distinctes, chacune sous son propre intitulé :
 *
 *   encaissé              argent des commandes PAYÉES ;
 *   billets vendus        places des commandes payées ;
 *   réservations en attente  places retenues, pas encore payées — donc pas encaissées ;
 *   entrées validées      billets déjà scannés à la porte.
 */
export default async function EventOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, event } = await requireEvent(id);

  const stats = await getEventStats(user.organizationId, id);
  if (!stats) notFound();

  const timeline = await getSalesTimeline(user.organizationId, id);
  const base = `/admin/evenements/${id}`;
  const readAt = formatClock(new Date(), event.timezone);

  return (
    <div>
      <LiveRefresh intervalMs={20_000} />

      <section aria-labelledby="kpi-titre">
        <h2 id="kpi-titre" className="sr-only">
          Chiffres clés
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Encaissé"
            value={formatCents(stats.revenueCents)}
            detail="commandes payées"
            emphasis
          />
          <Stat
            label="Billets vendus"
            value={String(stats.sold)}
            unit={`/ ${stats.capacity}`}
            detail="commandes payées"
          />
          <Stat
            label="Réservations en attente"
            value={String(stats.held)}
            unit={stats.held > 1 ? 'places' : 'place'}
            detail={
              stats.pendingCents > 0
                ? `${formatCents(stats.pendingCents)} non encaissés`
                : 'rien en attente de paiement'
            }
          />
          <Stat
            label="Entrées validées"
            value={String(stats.checkedIn)}
            unit={`/ ${stats.sold}`}
            detail="billets scannés à l'entrée"
          />
        </div>

        <p className="text-ink-muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <RefreshCw className="size-3.5" aria-hidden />
            Actualisé toutes les 20 s · dernière lecture à {readAt} (heure de {zoneCity(event.timezone)})
          </span>
          <Link
            href={`${base}/liste-attente`}
            className="text-ink-soft hover:text-ink font-semibold underline underline-offset-4"
          >
            Liste d&apos;attente : {stats.waitingListSize}{' '}
            {stats.waitingListSize > 1 ? 'personnes' : 'personne'}
          </Link>
        </p>
      </section>

      <section aria-labelledby="rythme-titre" className="mt-12">
        <h2 id="rythme-titre" className="display text-display-md">
          Rythme des ventes
        </h2>
        <div className="mt-5">
          <SalesChart
            points={timeline}
            capacity={stats.capacity}
            timezoneLabel={`heure de ${zoneCity(event.timezone)}`}
          />
        </div>
      </section>

      <section aria-labelledby="categories-titre" className="mt-12">
        <h2 id="categories-titre" className="display text-display-md">
          Par catégorie de place
        </h2>

        {/* Ordinateur : tableau. */}
        <div className="border-rule bg-paper shadow-panel mt-5 hidden overflow-hidden rounded-panel border md:block">
          <table className="data-table">
            <caption className="sr-only">Ventes et encaissements par catégorie de place</caption>
            <thead>
              <tr>
                <th scope="col">Catégorie</th>
                <th scope="col" className="num">
                  Vendues
                </th>
                <th scope="col" className="num">
                  En attente
                </th>
                <th scope="col" className="num">
                  Restantes
                </th>
                <th scope="col" className="num">
                  Encaissé
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.byTicketType.map((type) => (
                <tr key={type.id}>
                  <th scope="row" className="min-w-[14rem] text-left font-semibold">
                    {type.name}
                    <FillMeter
                      className="mt-2 max-w-[16rem] font-normal"
                      label={`Remplissage de ${type.name}`}
                      sold={type.sold}
                      held={type.held}
                      capacity={type.total}
                    />
                  </th>
                  <td className="num">
                    {type.sold} <span className="text-ink-muted">/ {type.total}</span>
                  </td>
                  <td className="num">{type.held > 0 ? type.held : '—'}</td>
                  <td className="num">
                    {type.available === 0 ? (
                      <span className="text-danger-ink font-semibold">Complet</span>
                    ) : (
                      type.available
                    )}
                  </td>
                  <td className="num font-semibold">{formatCents(type.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile : une carte par catégorie. */}
        <ul className="mt-5 space-y-3 md:hidden">
          {stats.byTicketType.map((type) => (
            <li key={type.id} className="border-rule bg-paper shadow-panel rounded-panel border p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-semibold">{type.name}</p>
                <p className="display text-display-sm tabular-nums">{formatCents(type.revenueCents)}</p>
              </div>
              <FillMeter
                className="mt-3"
                label={`Remplissage de ${type.name}`}
                sold={type.sold}
                held={type.held}
                capacity={type.total}
              />
              <p className="text-ink-soft mt-2 text-sm">
                {type.available === 0 ? (
                  <span className="text-danger-ink font-semibold">Complet</span>
                ) : (
                  `${type.available} restante${type.available > 1 ? 's' : ''}`
                )}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {stats.sold > 0 && (
        <section aria-labelledby="entrees-titre" className="mt-12">
          <h2 id="entrees-titre" className="display text-display-md">
            Entrées
          </h2>
          <div className="border-rule bg-paper shadow-panel mt-5 rounded-panel border p-5 sm:p-6">
            <p className="display text-display-lg tabular-nums">
              {stats.checkedIn}
              <span className="text-ink-muted font-sans text-lg font-medium normal-case tracking-normal">
                {' '}
                / {stats.sold} billets validés
              </span>
            </p>
            <div
              role="progressbar"
              aria-label="Entrées validées"
              aria-valuemin={0}
              aria-valuemax={stats.sold}
              aria-valuenow={stats.checkedIn}
              className="bg-sunken mt-4 h-2.5 overflow-hidden rounded-[2px]"
            >
              <div
                className="bg-ink h-full"
                style={{ width: `${Math.round((stats.checkedIn / stats.sold) * 100)}%` }}
              />
            </div>
            <p className="text-ink-soft mt-3 text-[0.9375rem]">
              {stats.sold - stats.checkedIn === 0
                ? 'Tout le monde est entré.'
                : `${stats.sold - stats.checkedIn} personne${stats.sold - stats.checkedIn > 1 ? 's' : ''} pas encore arrivée${stats.sold - stats.checkedIn > 1 ? 's' : ''}.`}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
