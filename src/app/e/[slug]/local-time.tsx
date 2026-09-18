'use client';

import { useEffect, useState } from 'react';

/**
 * Affiche l'heure de l'événement dans le fuseau du visiteur.
 *
 * Rendu côté client uniquement : le serveur ne connaît pas le fuseau du
 * navigateur, et le deviner depuis l'adresse IP donne des résultats faux. Le
 * bloc n'apparaît que si le décalage est réel — inutile d'écrire « soit 20 h
 * chez vous » à quelqu'un qui est déjà à Bordeaux.
 */
export function LocalTimeNote({
  startsAtIso,
  eventTimezone,
}: {
  startsAtIso: string;
  eventTimezone: string;
}) {
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const viewerTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!viewerTimezone || viewerTimezone === eventTimezone) return;

    const date = new Date(startsAtIso);

    const inZone = (tz: string) =>
      new Intl.DateTimeFormat('fr-FR', {
        timeZone: tz,
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(date);

    // Fuseaux différents mais même heure murale (Paris / Madrid) : on se tait.
    if (inZone(viewerTimezone) === inZone(eventTimezone)) return;

    const offset = new Intl.DateTimeFormat('fr-FR', {
      timeZone: viewerTimezone,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value;

    setNote(`Soit ${inZone(viewerTimezone)} chez vous (${offset ?? viewerTimezone}).`);
  }, [startsAtIso, eventTimezone]);

  if (!note) return null;

  return (
    <p className="border-copper-400 bg-copper-400/10 text-ink-700 mt-4 rounded-r-lg border-l-2 px-3 py-2 text-sm">
      {note}
    </p>
  );
}
