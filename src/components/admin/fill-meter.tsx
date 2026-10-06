import { cn } from '@/lib/cn';

/**
 * Jauge de remplissage.
 *
 * L'information ne tient pas à la couleur : le chiffre exact est toujours écrit,
 * la barre n'est qu'un repère visuel. Elle reste donc lisible en niveaux de gris
 * et pour une personne daltonienne. `role="progressbar"` la rend lisible aux
 * lecteurs d'écran avec sa valeur.
 */
export function FillMeter({
  label,
  sold,
  held = 0,
  capacity,
  className,
}: {
  label: string;
  sold: number;
  /** Places retenues par une réservation pas encore payée. */
  held?: number;
  capacity: number;
  className?: string;
}) {
  const total = Math.max(capacity, 1);
  const soldPct = Math.min(100, (sold / total) * 100);
  const heldPct = Math.min(100 - soldPct, (held / total) * 100);
  const percent = Math.round(((sold + held) / total) * 100);

  return (
    <div className={className}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={sold + held}
        aria-valuetext={`${sold} vendues${held > 0 ? `, ${held} en attente de paiement` : ''} sur ${capacity}`}
        className="bg-sunken flex h-2.5 overflow-hidden rounded-[2px]"
      >
        <div className="bg-ink h-full" style={{ width: `${soldPct}%` }} />
        {/* Hachures : les places retenues se distinguent des vendues sans dépendre d'une teinte. */}
        <div
          className={cn('h-full bg-ink-soft/60', held === 0 && 'hidden')}
          style={{
            width: `${heldPct}%`,
            backgroundImage:
              'repeating-linear-gradient(135deg, transparent 0 3px, rgb(242 238 230 / 0.85) 3px 5px)',
          }}
        />
      </div>
      <p className="text-ink-muted mt-1.5 text-sm tabular-nums">
        {sold} / {capacity} vendues
        {held > 0 && ` · ${held} en attente`} · {percent} %
      </p>
    </div>
  );
}
