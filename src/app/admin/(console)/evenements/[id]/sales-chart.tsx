import { ChartLine } from 'lucide-react';
import { EmptyState } from '@/components/ui/states';
import { formatCents } from '@/lib/money';
import type { SalesPoint } from '@/server/reporting';

/**
 * Courbe des ventes cumulées.
 *
 * Choix de construction :
 *
 *  • Les axes et repères sont du TEXTE HTML, pas du texte SVG. Un texte SVG
 *    suit l'échelle du dessin : sur un téléphone de 360 px, un libellé de 12 px
 *    deviendrait illisible. Ici, il garde sa taille réelle.
 *  • Le tracé est un SVG étiré sans déformation de l'épaisseur du trait
 *    (`non-scaling-stroke`) ; les points sont des éléments HTML pour rester ronds.
 *  • L'information ne tient jamais à la couleur : une seule courbe, une jauge
 *    en pointillés explicitement nommée, et le tableau des chiffres jour par
 *    jour est disponible sous le graphique.
 *
 * Ce qui compte n'est pas le total — affiché plus haut — mais la PENTE : un
 * palier dit que la communication est retombée, une reprise qu'une annonce a
 * porté.
 */
export function SalesChart({
  points,
  capacity,
  timezoneLabel,
}: {
  points: SalesPoint[];
  capacity: number;
  /** Fuseau dans lequel les jours sont comptés, ex. « heure de Paris ». */
  timezoneLabel: string;
}) {
  const total = points.at(-1)?.cumulativeTickets ?? 0;

  if (total === 0) {
    return (
      <EmptyState icon={ChartLine} title="Aucune vente pour le moment">
        La courbe apparaîtra dès la première commande payée. Les réservations en attente de
        paiement n&apos;y figurent pas.
      </EmptyState>
    );
  }

  const maxValue = Math.max(capacity, total, 1);
  const x = (i: number) => (points.length === 1 ? 50 : (i / (points.length - 1)) * 100);
  const y = (value: number) => (value / maxValue) * 100;

  const line = points.map((p, i) => `${x(i).toFixed(2)},${(100 - y(p.cumulativeTickets)).toFixed(2)}`);
  const area = `M0,100 L${line.join(' L')} L100,100 Z`;
  const showDots = points.length <= 16;

  const first = points[0];
  const last = points.at(-1)!;
  const revenue = points.reduce((sum, p) => sum + p.revenueCents, 0);
  const best = points.reduce((b, p) => (p.tickets > b.tickets ? p : b), points[0]);
  const middle = points[Math.floor(points.length / 2)];

  return (
    <figure className="border-rule bg-paper shadow-panel rounded-panel border p-5 sm:p-6">
      <figcaption className="mb-5">
        <p className="font-semibold">Billets vendus, cumulés</p>
        <p className="text-ink-muted text-sm">
          Du {formatDay(first.day)} au {formatDay(last.day)} · un point par jour, {timezoneLabel}
        </p>
      </figcaption>

      <div className="grid grid-cols-[2.75rem_1fr] gap-x-3">
        {/* Repères verticaux, en texte réel. */}
        <div className="relative h-56 text-right text-xs tabular-nums text-ink-muted" aria-hidden="true">
          {[0, 0.5, 1].map((ratio) => (
            <span
              key={ratio}
              className="absolute right-0 -translate-y-1/2 leading-none"
              style={{ bottom: `${ratio * 100}%` }}
            >
              {Math.round(maxValue * ratio)}
            </span>
          ))}
        </div>

        <div className="relative h-56">
          {/* Lignes de repère. */}
          {[0, 0.5, 1].map((ratio) => (
            <div
              key={ratio}
              className="border-rule absolute inset-x-0 border-t"
              style={{ bottom: `${ratio * 100}%` }}
              aria-hidden="true"
            />
          ))}

          {/* Jauge : la limite physique de la salle, nommée en toutes lettres. */}
          <div
            className="border-ink-soft absolute inset-x-0 border-t-2 border-dashed"
            style={{ bottom: `${y(capacity)}%` }}
            aria-hidden="true"
          >
            <span className="bg-paper text-ink-soft absolute right-0 -top-6 px-1.5 text-xs font-semibold">
              Jauge : {capacity}
            </span>
          </div>

          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
            aria-hidden="true"
            focusable="false"
          >
            <path d={area} className="fill-ink/10" />
            <polyline
              points={line.join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.75}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="text-ink"
            />
          </svg>

          {showDots &&
            points.map((p, i) => (
              <span
                key={p.day}
                aria-hidden="true"
                className="bg-ink border-paper absolute size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full border-2"
                style={{ left: `${x(i)}%`, bottom: `${y(p.cumulativeTickets)}%` }}
              />
            ))}
        </div>

        {/* Repères horizontaux : début, milieu, fin. */}
        <span />
        <div className="text-ink-muted mt-2 flex justify-between text-xs" aria-hidden="true">
          <span>{formatDay(first.day)}</span>
          {points.length > 2 && <span>{formatDay(middle.day)}</span>}
          <span>{formatDay(last.day)}</span>
        </div>
      </div>

      <dl className="border-rule mt-6 grid grid-cols-3 gap-4 border-t pt-4 text-sm">
        <div>
          <dt className="text-ink-muted text-xs">Billets vendus</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{total}</dd>
        </div>
        <div>
          <dt className="text-ink-muted text-xs">Encaissé sur la période</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{formatCents(revenue)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted text-xs">Meilleure journée</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {best.tickets > 0 ? `${best.tickets} le ${formatDay(best.day)}` : '—'}
          </dd>
        </div>
      </dl>

      {/* Les mêmes données, sans le dessin : lisibles au lecteur d'écran et au tableur. */}
      <details className="border-rule mt-5 border-t pt-4">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold underline-offset-4 hover:underline">
          Voir les chiffres jour par jour
        </summary>
        <div className="mt-3 max-h-72 overflow-auto">
          <table className="data-table">
            <caption className="sr-only">Ventes par jour, {timezoneLabel}</caption>
            <thead>
              <tr>
                <th scope="col">Jour</th>
                <th scope="col" className="num">
                  Billets
                </th>
                <th scope="col" className="num">
                  Cumul
                </th>
                <th scope="col" className="num">
                  Encaissé
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.day}>
                  <th scope="row" className="font-medium">
                    {formatDay(p.day, true)}
                  </th>
                  <td className="num">{p.tickets}</td>
                  <td className="num">{p.cumulativeTickets}</td>
                  <td className="num">{formatCents(p.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function formatDay(iso: string, long = false): string {
  const [year, month, day] = iso.split('-').map(Number);
  // Midi UTC : évite qu'un décalage de fuseau fasse basculer la date affichée.
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: long ? 'long' : 'short',
    ...(long ? { weekday: 'short' as const } : {}),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}
