import Link from 'next/link';
import { requireEvent } from '@/lib/org';
import { getCheckinStats } from '@/server/checkin';
import { formatDateTime } from '@/lib/dates';
import { Scanner } from './scanner';
import { RegisterServiceWorker } from './register-sw';

export const dynamic = 'force-dynamic';

/**
 * Poste de contrôle à l'entrée.
 *
 * Conçu pour un téléphone tenu d'une main, dans le noir, avec un réseau qui ne
 * répond pas. Toute la validation se fait côté client une fois la liste chargée ;
 * le serveur est rejoint dès qu'il redevient joignable.
 */
export default async function CheckinPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const { event } = await requireEvent(eventId);
  const stats = await getCheckinStats(eventId);

  return (
    <div>
      <RegisterServiceWorker />
      <Link
        href={`/admin/evenements/${eventId}`}
        className="text-ink-500 hover:text-ink-800 text-sm"
      >
        ← {event.title}
      </Link>
      <h1 className="text-ink-900 mt-1 text-xl font-semibold tracking-tight">
        Contrôle à l&apos;entrée
      </h1>
      <p className="text-ink-500 mt-1 text-sm">
        {formatDateTime(event.startsAt, event.timezone)}
      </p>

      <Scanner
        eventId={eventId}
        eventTitle={event.title}
        initialStats={stats}
      />
    </div>
  );
}
