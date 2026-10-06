'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Sélecteur de quantité.
 *
 * Deux boutons de 44 × 44 px (cible tactile minimale) autour d'une valeur
 * annoncée à chaque changement (`aria-live`). Le groupe porte le nom de la
 * catégorie : un lecteur d'écran annonce « Quantité Fosse » et non deux boutons
 * « plus » et « moins » sans contexte.
 */
export function QuantityStepper({
  label,
  value,
  min = 0,
  max,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const stepButton =
    'grid size-11 place-items-center rounded-control border border-rule-strong bg-paper text-ink transition-colors duration-150 hover:bg-ink hover:text-canvas disabled:cursor-not-allowed disabled:border-rule disabled:bg-transparent disabled:text-ink-muted/50 disabled:hover:bg-transparent disabled:hover:text-ink-muted/50';

  return (
    <div role="group" aria-label={`Quantité : ${label}`} className="flex items-center gap-1">
      <button
        type="button"
        className={stepButton}
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label={`Retirer une place ${label}`}
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <output
        aria-live="polite"
        className={cn(
          'display grid h-11 w-10 place-items-center text-[1.75rem] tabular-nums',
          value > 0 ? 'text-ink' : 'text-ink-muted',
        )}
      >
        {value}
      </output>
      <button
        type="button"
        className={stepButton}
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label={`Ajouter une place ${label}`}
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
