import {
  Ban,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Info,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'copper';
export type Surface = 'ivory' | 'night';

/**
 * Chaque ton a son pictogramme PAR DÉFAUT : l'état se lit au pictogramme et au
 * texte, jamais à la seule couleur. Vert et rouge se confondent pour une partie
 * des spectateurs et de l'équipe — c'est le cas de l'auteur de ce brief.
 * Les pictogrammes ont des silhouettes différentes (coche, croix, point
 * d'exclamation, horloge, sens interdit) pour rester distincts en niveaux de gris.
 */
const DEFAULT_ICON: Record<Tone, LucideIcon> = {
  success: CircleCheck,
  warning: CircleAlert,
  danger: CircleX,
  info: Info,
  neutral: Ban,
  copper: Clock,
};

const ivory: Record<Tone, string> = {
  success: 'bg-success-wash text-success-ink border-success-ink/30',
  warning: 'bg-warning-wash text-warning-ink border-warning-ink/30',
  danger: 'bg-danger-wash text-danger-ink border-danger-ink/30',
  info: 'bg-info-wash text-info-ink border-info-ink/30',
  neutral: 'bg-sunken text-ink-soft border-rule-strong/60',
  copper: 'bg-copper-wash text-copper-ink border-copper-ink/30',
};

const night: Record<Tone, string> = {
  success: 'bg-success-night/12 text-success-night border-success-night/45',
  warning: 'bg-warning-night/12 text-warning-night border-warning-night/45',
  danger: 'bg-danger-night/12 text-danger-night border-danger-night/45',
  info: 'bg-info-night/12 text-info-night border-info-night/45',
  neutral: 'bg-night-high text-on-night-soft border-night-rule-strong',
  copper: 'bg-copper/15 text-copper border-copper/45',
};

export function StatusBadge({
  tone = 'neutral',
  surface = 'ivory',
  icon,
  className,
  children,
}: {
  tone?: Tone;
  surface?: Surface;
  /** Remplace le pictogramme par défaut du ton. */
  icon?: LucideIcon;
  className?: string;
  children: React.ReactNode;
}) {
  const Icon = icon ?? DEFAULT_ICON[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1 text-[0.8125rem] leading-none font-semibold whitespace-nowrap',
        surface === 'ivory' ? ivory[tone] : night[tone],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden strokeWidth={2.25} />
      {children}
    </span>
  );
}
