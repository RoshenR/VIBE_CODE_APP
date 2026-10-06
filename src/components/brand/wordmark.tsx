import { cn } from '@/lib/cn';
import { WaveGlyph } from './wave-lines';

/**
 * Nom de la marque, en police d'affiche, précédé des trois vagues.
 *
 * Le texte reste du vrai texte (sélectionnable, lu par les lecteurs d'écran) ;
 * seul le pictogramme est décoratif.
 */
export function Wordmark({
  className,
  size = 'md',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = {
    sm: 'text-[1.05rem] gap-2',
    md: 'text-[1.3rem] gap-2.5',
    lg: 'text-[1.9rem] gap-3',
  };

  return (
    <span
      className={cn('display inline-flex items-center leading-none', sizes[size], className)}
    >
      <WaveGlyph className="text-copper" />
      <span>
        Les Nuits <span className="text-copper">de la Garonne</span>
      </span>
    </span>
  );
}
