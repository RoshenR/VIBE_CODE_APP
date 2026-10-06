'use client';

import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatClock } from '@/lib/dates';

/**
 * Affiche l'heure de l'événement dans le fuseau du visiteur.
 *
 * Rendu côté client uniquement : le serveur ne connaît pas le fuseau du
 * navigateur, et le deviner depuis l'adresse IP donne des résultats faux. Le
 * bloc n'apparaît que si le décalage est réel — inutile d'écrire « soit 20 h
 * chez vous » à quelqu'un qui est déjà à Bordeaux.
 *
 * Indispensable pour le public à l'étranger des événements en ligne : « 20 h 30 »
 * sans fuseau ne veut rien dire à Montréal.
 */
export function LocalTimeNote({
  startsAtIso,
  eventTimezone,
  surface = 'night',
}: {
  startsAtIso: string;
  eventTimezone: string;
  surface?: 'night' | 'ivory';
}) {
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const viewerTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!viewerTimezone || viewerTimezone === eventTimezone) return;

    const date = new Date(startsAtIso);

    // Jour et heure écrits comme partout ailleurs sur le site : « vendredi 16 octobre à 2 h ».
    const inZone = (tz: string) =>
      `${new Intl.DateTimeFormat('fr-FR', {
        timeZone: tz,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(date)} à ${formatClock(date, tz)}`;

    // Fuseaux différents mais même heure murale (Paris / Madrid) : on se tait.
    if (inZone(viewerTimezone) === inZone(eventTimezone)) return;

    const offset = new Intl.DateTimeFormat('fr-FR', {
      timeZone: viewerTimezone,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value;

    const city = (viewerTimezone.split('/').pop() ?? viewerTimezone).replace(/_/g, ' ');
    setNote(`Chez vous (heure de ${city}, ${offset ?? viewerTimezone}) : ${inZone(viewerTimezone)}.`);
  }, [startsAtIso, eventTimezone]);

  if (!note) return null;

  return (
    <p
      className={cn(
        'mt-5 flex max-w-xl items-start gap-2.5 rounded-control border-l-2 border-copper px-3 py-2 text-[0.9375rem]',
        surface === 'night'
          ? 'bg-night-raised text-on-night'
          : 'bg-copper-wash text-ink',
      )}
    >
      <Globe className="mt-0.5 size-4 shrink-0 text-copper-ink" aria-hidden />
      <span>{note}</span>
    </p>
  );
}
