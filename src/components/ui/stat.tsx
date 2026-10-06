import { cn } from '@/lib/cn';

/**
 * Indicateur chiffré de l'administration.
 *
 * Le chiffre est en police d'affiche (lisible d'un coup d'œil, chiffres
 * tabulaires) ; l'intitulé dit précisément de quoi il s'agit. Les notions
 * voisines — encaissé, vendu, en attente, entré — ne se confondent jamais :
 * chacune a son intitulé et, quand c'est utile, sa précision.
 *
 * Aucune évolution en pourcentage : le système ne conserve pas d'historique
 * comparable, et un « +12 % » inventé serait un mensonge.
 */
export function Stat({
  label,
  value,
  unit,
  detail,
  emphasis = false,
  className,
}: {
  label: string;
  value: string;
  /** Complément du chiffre : « / 500 », « places ». */
  unit?: string;
  detail?: string;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col justify-between gap-3 rounded-panel border p-4 sm:p-5',
        emphasis
          ? 'surface-night border-night-rule shadow-panel'
          : 'border-rule bg-paper text-ink shadow-panel',
        className,
      )}
    >
      <p
        className={cn(
          'eyebrow',
          emphasis ? 'text-on-night-soft' : 'text-ink-soft',
        )}
      >
        {label}
      </p>
      <div>
        <p className="display flex items-baseline gap-1.5 text-display-md tabular-nums">
          {value}
          {unit && (
            <span
              className={cn(
                'font-sans text-base font-medium tracking-normal normal-case',
                emphasis ? 'text-on-night-muted' : 'text-ink-muted',
              )}
            >
              {unit}
            </span>
          )}
        </p>
        {detail && (
          <p
            className={cn(
              'mt-1 text-sm',
              emphasis ? 'text-on-night-soft' : 'text-ink-muted',
            )}
          >
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}
