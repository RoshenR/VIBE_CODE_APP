import { CalendarDays, MapPin, Globe } from 'lucide-react';
import { formatClock, formatLongDate, zoneCity } from '@/lib/dates';
import { requireEvent } from '@/lib/org';
import { getCheckinStats } from '@/server/checkin';
import { RegisterServiceWorker } from './register-sw';
import { Scanner } from './scanner';

export const dynamic = 'force-dynamic';

/**
 * Poste de contrôle à l'entrée.
 *
 * Le droit exigé est `billets.scanner` — celui du rôle « poste d'entrée » — et NON
 * `chiffres.lire`. Une version antérieure demandait `chiffres.lire` par défaut :
 * le rôle dont c'est l'unique page recevait un 404 sur sa propre page de travail.
 *
 * La page n'affiche aucun montant ni aucun chiffre de vente : seulement les
 * compteurs d'entrées, que la porte doit connaître.
 */
export default async function CheckinPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { event } = await requireEvent(eventId, 'billets.scanner');
  const stats = await getCheckinStats(eventId);

  return (
    <div>
      <RegisterServiceWorker />

      <div className="mx-auto mb-6 max-w-2xl">
        <p className="eyebrow text-copper">Contrôle à l&apos;entrée</p>
        <h1 className="display text-display-lg mt-2">{event.title}</h1>
        <p className="text-on-night-soft mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.9375rem]">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-4 shrink-0" aria-hidden />
            <span className="first-letter:uppercase">
              {formatLongDate(event.startsAt, event.timezone)}
            </span>{' '}
            · {formatClock(event.startsAt, event.timezone)}{' '}
            <span className="text-on-night-muted">(heure de {zoneCity(event.timezone)})</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            {event.isOnline ? (
              <Globe className="size-4 shrink-0" aria-hidden />
            ) : (
              <MapPin className="size-4 shrink-0" aria-hidden />
            )}
            {event.isOnline ? 'En ligne' : (event.venueName ?? 'Lieu à préciser')}
          </span>
        </p>
      </div>

      <Scanner
        eventId={eventId}
        eventTitle={event.title}
        timezone={event.timezone}
        initialStats={stats}
      />
    </div>
  );
}
