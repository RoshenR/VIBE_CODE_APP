import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublicEvent } from '@/server/catalog';
import { formatDateTime, formatTime, zoneLabel } from '@/lib/dates';
import { Badge, SiteFooter, SiteHeader } from '@/app/_components/chrome';
import { BookingForm } from './booking-form';
import { WaitlistForm } from './waitlist-form';
import { LocalTimeNote } from './local-time';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await getPublicEvent(slug);
  return { title: event?.title ?? 'Événement' };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getPublicEvent(slug);
  if (!event) notFound();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <header>
          <p className="text-ink-500 text-sm">{event.organizationName}</p>
          <h1 className="text-ink-900 mt-1 text-2xl font-semibold tracking-tight">
            {event.title}
          </h1>

          <div className="text-ink-600 mt-4 space-y-1.5 text-sm">
            <p>
              <span className="text-ink-400">Date&nbsp;:</span>{' '}
              {formatDateTime(event.startsAt, event.timezone)}{' '}
              <span className="text-ink-400">
                ({zoneLabel(event.startsAt, event.timezone)})
              </span>
            </p>
            {event.doorsAt && (
              <p>
                <span className="text-ink-400">Ouverture des portes&nbsp;:</span>{' '}
                {formatTime(event.doorsAt, event.timezone)}
              </p>
            )}
            <p>
              <span className="text-ink-400">Lieu&nbsp;:</span>{' '}
              {event.isOnline
                ? 'Événement en ligne (lien envoyé avant le début)'
                : `${event.venueName ?? 'À préciser'}${
                    event.venueAddress ? ` — ${event.venueAddress}` : ''
                  }`}
            </p>
          </div>

          {/*
            L'heure locale du visiteur est calculée dans son navigateur : le
            serveur ne peut pas la connaître. Indispensable pour le public à
            l'étranger des événements en ligne.
          */}
          <LocalTimeNote
            startsAtIso={event.startsAt.toISOString()}
            eventTimezone={event.timezone}
          />
        </header>

        {event.description && (
          <p className="text-ink-700 mt-6 leading-relaxed whitespace-pre-line">
            {event.description}
          </p>
        )}

        <section className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-ink-900 text-lg font-semibold">Places</h2>
            {event.soldOut && <Badge tone="danger">Complet</Badge>}
          </div>

          {event.soldOut ? (
            <div className="mt-4">
              <div className="border-ink-200 bg-ink-100 rounded-2xl border px-5 py-6">
                <p className="text-ink-800 font-medium">
                  Toutes les places sont vendues.
                </p>
                <p className="text-ink-600 mt-1 text-sm">
                  Inscrivez-vous sur la liste d&apos;attente&nbsp;: en cas de
                  désistement, les places sont proposées automatiquement, dans
                  l&apos;ordre d&apos;inscription. Vous recevrez un e-mail avec un
                  délai pour confirmer.
                </p>
              </div>
              <WaitlistForm
                eventId={event.id}
                ticketTypes={event.ticketTypes.map((t) => ({ id: t.id, name: t.name }))}
              />
            </div>
          ) : (
            <BookingForm
              eventSlug={event.slug}
              cancellationDeadlineHours={event.cancellationDeadlineHours}
              ticketTypes={event.ticketTypes}
            />
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
