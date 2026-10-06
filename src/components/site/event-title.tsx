import { splitTitle } from '@/lib/programme';
import { cn } from '@/lib/cn';

/**
 * Titre d'événement hiérarchisé : le nom en grand, le complément (« — Lieu »)
 * en dessous.
 *
 * Le tiret long est conservé dans le texte, masqué visuellement : un lecteur
 * d'écran lit « Nuit Électrique — Rocher de Palmer » en une phrase, comme le
 * titre complet de l'événement.
 *
 * Le complément est dimensionné selon sa longueur : « Rocher de Palmer » peut
 * se permettre une belle taille, une phrase de soixante caractères non — elle
 * écraserait le nom qu'elle est censée accompagner.
 */
export function EventTitle({
  title,
  subClassName,
}: {
  title: string;
  subClassName?: string;
}) {
  const { main, sub } = splitTitle(title);

  const subSize =
    sub === null ? '' : sub.length > 44 ? 'text-[0.3em]' : sub.length > 24 ? 'text-[0.38em]' : 'text-[0.46em]';

  return (
    <>
      {main}
      {sub && (
        <>
          <span className="sr-only"> — </span>
          <span
            className={cn('mt-[0.2em] block leading-[1.04] text-copper', subSize, subClassName)}
          >
            {sub}
          </span>
        </>
      )}
    </>
  );
}
