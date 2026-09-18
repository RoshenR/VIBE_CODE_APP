import type { SalesPoint } from '@/server/reporting';
import { formatCents } from '@/lib/money';

/**
 * Courbe des ventes cumulées.
 *
 * SVG rendu côté serveur, sans bibliothèque : une centaine de points ne justifie
 * pas d'embarquer un moteur graphique de 300 ko dans un outil qu'on consulte
 * depuis un téléphone en 3G.
 *
 * L'information utile n'est pas le total — il est déjà affiché plus haut — mais
 * la **pente** : un palier signale que la communication est retombée, une reprise
 * qu'une annonce a porté.
 */
export function SalesChart({
  points,
  capacity,
}: {
  points: SalesPoint[];
  capacity: number;
}) {
  if (points.length < 2) {
    return (
      <p className="text-ink-500 border-ink-200 rounded-2xl border border-dashed px-5 py-8 text-center text-sm">
        La courbe apparaîtra dès que les ventes auront démarré.
      </p>
    );
  }

  const width = 720;
  const height = 180;
  const padding = { top: 12, right: 12, bottom: 24, left: 40 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  // L'échelle monte jusqu'à la jauge : la courbe montre alors la distance
  // restante, pas seulement la progression.
  const maxValue = Math.max(capacity, points.at(-1)?.cumulativeTickets ?? 1, 1);

  const x = (i: number) => (i / (points.length - 1)) * innerWidth;
  const y = (value: number) => innerHeight - (value / maxValue) * innerHeight;

  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.cumulativeTickets).toFixed(1)}`);
  const area = `M0,${innerHeight} L${line.join(' L')} L${innerWidth},${innerHeight} Z`;

  const peakDay = points.reduce((best, p) => (p.tickets > best.tickets ? p : best), points[0]);
  const total = points.at(-1)?.cumulativeTickets ?? 0;
  const revenue = points.reduce((sum, p) => sum + p.revenueCents, 0);

  return (
    <div className="border-ink-200 rounded-2xl border bg-white p-5">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Courbe des ventes cumulées : ${total} places vendues sur ${capacity} depuis le ${formatDay(points[0].day)}.`}
      >
        <g transform={`translate(${padding.left},${padding.top})`}>
          {/* Repères horizontaux : 0, moitié, jauge complète. */}
          {[0, 0.5, 1].map((ratio) => (
            <g key={ratio}>
              <line
                x1={0}
                x2={innerWidth}
                y1={y(maxValue * ratio)}
                y2={y(maxValue * ratio)}
                stroke="currentColor"
                strokeWidth={1}
                className="text-ink-200"
                strokeDasharray={ratio === 0 ? undefined : '3 3'}
              />
              <text
                x={-8}
                y={y(maxValue * ratio) + 4}
                textAnchor="end"
                className="fill-ink-400 text-[11px]"
              >
                {Math.round(maxValue * ratio)}
              </text>
            </g>
          ))}

          {/* Ligne de jauge : la limite physique de la salle. */}
          {capacity <= maxValue && (
            <line
              x1={0}
              x2={innerWidth}
              y1={y(capacity)}
              y2={y(capacity)}
              stroke="currentColor"
              strokeWidth={1.5}
              className="text-rose-400"
              strokeDasharray="5 4"
            />
          )}

          <path d={area} className="fill-ink-900/10" />
          <polyline
            points={line.join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="text-ink-900"
          />

          <circle
            cx={x(points.length - 1)}
            cy={y(total)}
            r={4}
            className="fill-ink-900"
          />

          <text x={0} y={innerHeight + 18} className="fill-ink-400 text-[11px]">
            {formatDay(points[0].day)}
          </text>
          <text
            x={innerWidth}
            y={innerHeight + 18}
            textAnchor="end"
            className="fill-ink-400 text-[11px]"
          >
            {formatDay(points.at(-1)!.day)}
          </text>
        </g>
      </svg>

      <dl className="border-ink-200 mt-4 grid grid-cols-3 gap-4 border-t pt-4 text-sm">
        <div>
          <dt className="text-ink-500 text-xs">Places vendues</dt>
          <dd className="font-semibold tabular-nums">{total}</dd>
        </div>
        <div>
          <dt className="text-ink-500 text-xs">Encaissé</dt>
          <dd className="font-semibold tabular-nums">{formatCents(revenue)}</dd>
        </div>
        <div>
          <dt className="text-ink-500 text-xs">Meilleure journée</dt>
          <dd className="font-semibold tabular-nums">
            {peakDay.tickets > 0 ? `${peakDay.tickets} le ${formatDay(peakDay.day)}` : '—'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(
    // Midi UTC : évite qu'un décalage de fuseau fasse basculer la date affichée.
    new Date(Date.UTC(year, month - 1, day, 12)),
  );
}
