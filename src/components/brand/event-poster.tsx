import { cn } from '@/lib/cn';
import { dateParts } from '@/lib/dates';
import { hashSeed } from '@/lib/programme';
import { WaveLines } from './wave-lines';

/**
 * Affiche d'événement générée.
 *
 * Le dépôt ne contient aucune photographie : plutôt que de présenter un visuel
 * générique comme « la photo de l'artiste », chaque événement reçoit une affiche
 * typographique construite uniquement à partir de ses propres données — titre,
 * date, lieu. Rien n'est inventé.
 *
 * Quatre compositions, choisies de façon déterministe par le slug : une
 * programmation reste variée sans réglage, et une affiche ne change jamais d'un
 * chargement à l'autre.
 *
 *   0 — nuit et lueur cuivre    (reflet d'un projecteur sur l'eau)
 *   1 — nuit et disque sauge    (lune et son reflet)
 *   2 — ivoire et disque cuivre (affiche imprimée)
 *   3 — aplat cuivre            (affiche sérigraphiée)
 *
 * Règle de composition : les reflets occupent une zone RÉSERVÉE entre le chiffre
 * de la date et le titre. Ils ne passent jamais derrière un texte, et aucun
 * texte n'est posé sur une teinte qui ne le contraste pas assez (le disque sauge
 * reste dans la zone des reflets, hors de tout texte).
 *
 * Les tailles sont exprimées en unités de conteneur (`cqw`) : l'affiche garde ses
 * proportions, qu'elle occupe 280 px dans une liste ou 440 px dans un en-tête.
 *
 * Toute l'affiche est décorative (`aria-hidden`) : l'information qu'elle porte
 * figure toujours en texte dans la page.
 */

type Variant = 0 | 1 | 2 | 3;

interface Props {
  title: string;
  slug: string;
  startsAt: Date;
  timezone: string;
  collectif: string;
  /** Salle ou « En ligne ». */
  place: string;
  className?: string;
}

export function EventPoster({ title, slug, startsAt, timezone, collectif, place, className }: Props) {
  const seed = hashSeed(slug);
  const variant = (seed % 4) as Variant;
  const d = dateParts(startsAt, timezone);

  const dark = variant === 0 || variant === 1;
  const ink = dark ? 'text-on-night' : 'text-night';
  const soft = dark ? 'text-on-night-soft' : 'text-night/80';

  return (
    <div
      aria-hidden="true"
      className={cn(
        '@container relative isolate aspect-[4/5] w-full overflow-hidden rounded-poster shadow-poster',
        variant <= 1 && 'bg-night ring-1 ring-white/10 ring-inset',
        variant === 2 && 'bg-canvas',
        variant === 3 && 'bg-copper',
        className,
      )}
    >
      {/* --- Fond, propre à chaque composition -------------------------------- */}

      {variant === 0 && (
        // Lueur cuivre, derrière la zone des reflets uniquement.
        <div
          className="absolute -right-[18cqw] top-[40cqw] size-[86cqw] rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, rgb(230 167 125 / 0.9), rgb(230 167 125 / 0.34) 56%, transparent 74%)',
          }}
        />
      )}

      {variant === 2 && (
        <div className="absolute -right-[22cqw] -bottom-[24cqw] size-[80cqw] rounded-full bg-copper" />
      )}

      {variant === 3 && <div className="absolute inset-x-0 top-0 h-[17cqw] bg-night" />}

      {/* Voile sombre sous le titre : garantit le contraste sur les deux nuits. */}
      {dark && (
        <div className="absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-t from-night via-night/85 to-transparent" />
      )}

      {/* --- Contenu : une colonne, la zone des reflets s'étire entre les textes - */}

      <div className="absolute inset-0 flex flex-col p-[7cqw]">
        <div
          className={cn(
            'flex items-start justify-between gap-[4cqw] text-[3.3cqw] leading-tight font-semibold tracking-[0.14em] uppercase',
            variant === 3 ? 'text-on-night' : soft,
          )}
        >
          <span className="max-w-[62%]">{collectif}</span>
          <span className="shrink-0">
            {d.weekdayShort} {d.year}
          </span>
        </div>

        <div className={cn('flex items-end gap-[3.5cqw]', variant === 3 ? 'mt-[8cqw]' : 'mt-[5cqw]')}>
          <span className={cn('display text-[34cqw] leading-[0.78] tabular-nums', ink)}>{d.day}</span>
          <span className={cn('display pb-[1.2cqw] text-[9cqw] leading-[0.9]', ink)}>{d.month}</span>
        </div>

        {/* Zone réservée aux reflets : aucun texte n'y passe. */}
        <div className="relative my-[3cqw] min-h-[12cqw] flex-1">
          {variant === 1 && (
            <div
              className="absolute top-1/2 right-[2cqw] aspect-square h-[88%] max-h-[34cqw] -translate-y-1/2 rounded-full"
              style={{
                background: 'linear-gradient(160deg, #a9c0b4 0%, #8fa99d 55%, #6f8b7e 100%)',
              }}
            />
          )}
          <WaveLines
            className={cn(
              'absolute inset-0',
              variant === 0 && 'text-on-night',
              variant === 1 && 'text-sage',
              variant === 2 && 'text-night',
              variant === 3 && 'text-night',
            )}
            seed={seed % 17}
            envelope={variant === 3 ? 'left' : variant === 2 ? 'center' : 'right'}
            lines={variant === 3 ? 8 : 7}
            amplitude={variant === 1 ? 1.15 : 0.95}
            strokeWidth={1.25}
          />
        </div>

        <div>
          {/*
            `line-clamp` masque tout débordement : avec une hauteur de ligne de
            0,95, l'accent d'une capitale (É, È…) de la première ligne dépasse de
            la boîte et serait coupé. Un padding haut compensé par une marge
            négative lui réserve la place sans déplacer le titre.
          */}
          <p
            className={cn(
              'display -mt-[2cqw] line-clamp-3 pt-[2cqw] text-[10.4cqw] leading-[0.95]',
              ink,
            )}
          >
            {title}
          </p>
          <p className={cn('mt-[3.2cqw] text-[3.6cqw] font-semibold', soft)}>
            {d.clock} · {place}
          </p>
        </div>
      </div>
    </div>
  );
}
