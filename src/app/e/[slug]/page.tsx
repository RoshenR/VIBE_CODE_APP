import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  DoorOpen,
  Globe,
  MapPin,
  Undo2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { EventPoster } from '@/components/brand/event-poster';
import { WaveLines } from '@/components/brand/wave-lines';
import { EventTitle } from '@/components/site/event-title';
import { PublicShell } from '@/components/site/public-shell';
import { SalesBadge } from '@/components/site/sales-badge';
import { isPaymentSimulated } from '@/lib/demo';
import { formatClock, formatLongDate, zoneCity, zoneLabel } from '@/lib/dates';
import { stagger } from '@/lib/cn';
import { getPublicEvent } from '@/server/catalog';
import { BookingPanel } from './booking-panel';
import { LocalTimeNote } from './local-time';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await getPublicEvent(slug);
  if (!event) return { title: 'Événement introuvable' };

  return {
    title: event.title,
    description: event.description
      ? event.description.slice(0, 160)
      : `${event.title} — réservez vos places en ligne.`,
  };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getPublicEvent(slug);
  if (!event) notFound();

  const place = event.isOnline ? 'En ligne' : (event.venueName ?? 'Lieu à préciser');
  const open = event.salesState === 'open';
  const zone = `heure de ${zoneCity(event.timezone)} (${zoneLabel(event.startsAt, event.timezone)})`;

  return (
    // Réserve la place de la barre d'action mobile : elle ne doit masquer aucun contenu.
    <PublicShell className={open ? 'pb-28 lg:pb-0' : undefined}>
      {/* ----------------------------------------------------------------- Hero */}
      <section className="surface-night grain relative overflow-hidden">
        <WaveLines
          className="pointer-events-none absolute right-0 bottom-0 h-[70%] w-[75%] text-copper opacity-[0.22]"
          seed={9}
          envelope="right"
          lines={11}
          amplitude={1}
        />

        <div className="page-container relative grid gap-10 py-8 sm:py-12 md:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] md:items-end lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-16 lg:py-14">
          <div>
            <Link
              href="/#programmation"
              className="reveal text-on-night-soft hover:text-on-night -ml-2 inline-flex min-h-11 items-center gap-2 rounded-control px-2 text-[0.9375rem] font-medium transition-colors"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Programmation
            </Link>

            <p className="eyebrow reveal text-copper mt-6" style={stagger(1)}>
              {event.organizationName} · {event.isOnline ? 'En ligne' : 'Sur place'}
            </p>

            <h1 className="display text-display-xl reveal mt-3" style={stagger(2)}>
              <EventTitle title={event.title} />
            </h1>

            <ul
              className="reveal mt-8 flex flex-col gap-3 text-[1.0625rem] sm:flex-row sm:flex-wrap sm:gap-x-8"
              style={stagger(3)}
            >
              <li className="flex items-center gap-2.5">
                <CalendarDays className="text-copper size-5 shrink-0" aria-hidden />
                <span className="first-letter:uppercase">
                  {formatLongDate(event.startsAt, event.timezone)}
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <Clock className="text-copper size-5 shrink-0" aria-hidden />
                <span>
                  {formatClock(event.startsAt, event.timezone)}{' '}
                  <span className="text-on-night-muted">· {zone}</span>
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                {event.isOnline ? (
                  <Globe className="text-copper size-5 shrink-0" aria-hidden />
                ) : (
                  <MapPin className="text-copper size-5 shrink-0" aria-hidden />
                )}
                <span>{place}</span>
              </li>
            </ul>

            <LocalTimeNote
              startsAtIso={event.startsAt.toISOString()}
              eventTimezone={event.timezone}
              surface="night"
            />

            <div className="reveal mt-7" style={stagger(4)}>
              <SalesBadge
                surface="night"
                state={event.salesState}
                available={event.totalAvailable}
                opensAt={event.opensAt}
                timezone={event.timezone}
              />
            </div>
          </div>

          <div className="reveal hidden md:block" style={stagger(2)}>
            <EventPoster
              title={event.title}
              slug={event.slug}
              startsAt={event.startsAt}
              timezone={event.timezone}
              collectif={event.organizationName}
              place={place}
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ Corps */}
      <div className="page-container grid gap-x-14 gap-y-12 py-12 lg:grid-cols-[minmax(0,1fr)_26rem] lg:py-16 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <section aria-labelledby="infos-titre" className="lg:col-start-1">
          <h2 id="infos-titre" className="display text-display-md">
            Infos pratiques
          </h2>

          <dl className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            <Fact icon={CalendarDays} label="Date et heure">
              <span className="block first-letter:uppercase">
                {formatLongDate(event.startsAt, event.timezone)}
              </span>
              {formatClock(event.startsAt, event.timezone)}
              <Sub>{zone}</Sub>
            </Fact>

            {event.doorsAt && (
              <Fact icon={DoorOpen} label="Ouverture des portes">
                {formatClock(event.doorsAt, event.timezone)}
              </Fact>
            )}

            {event.isOnline ? (
              <Fact icon={Globe} label="Format">
                Événement en ligne
                <Sub>Le lien de connexion vous est envoyé avant le début.</Sub>
              </Fact>
            ) : (
              <Fact icon={MapPin} label="Lieu">
                {event.venueName ?? 'À préciser'}
                {event.venueAddress && <Sub>{event.venueAddress}</Sub>}
              </Fact>
            )}

            <Fact icon={Undo2} label="Annulation">
              {event.cancellationDeadlineHours > 0
                ? `Possible en ligne jusqu'à ${event.cancellationDeadlineHours} h avant le début`
                : "Possible en ligne jusqu'au début de l'événement"}
              <Sub>Depuis le lien reçu par e-mail avec vos billets.</Sub>
            </Fact>

            <Fact icon={Users} label="Organisé par">
              {event.organizationName}
            </Fact>
          </dl>
        </section>

        <BookingPanel
          eventSlug={event.slug}
          eventId={event.id}
          ticketTypes={event.ticketTypes}
          salesState={event.salesState}
          opensAtIso={event.opensAt ? event.opensAt.toISOString() : null}
          timezone={event.timezone}
          cancellationDeadlineHours={event.cancellationDeadlineHours}
          holdMinutesCard={event.holdMinutesCard}
          holdHoursTransfer={event.holdHoursTransfer}
          waitlistOfferHours={event.waitlistOfferHours}
          simulated={isPaymentSimulated()}
        />

        {event.description && (
          <section aria-labelledby="a-propos-titre" className="lg:col-start-1">
            <h2 id="a-propos-titre" className="display text-display-md">
              À propos
            </h2>
            <p className="measure text-ink-soft mt-6 text-[1.0625rem] leading-relaxed whitespace-pre-line">
              {event.description}
            </p>
          </section>
        )}
      </div>
    </PublicShell>
  );
}

/* -------------------------------------------------------------------------- */

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <span className="bg-sunken text-ink grid size-11 shrink-0 place-items-center rounded-control">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <dt className="eyebrow text-ink-soft">{label}</dt>
        <dd className="mt-1.5 text-[1.0625rem] leading-snug font-medium">{children}</dd>
      </div>
    </div>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <span className="text-ink-muted mt-0.5 block text-[0.9375rem] font-normal">{children}</span>;
}
