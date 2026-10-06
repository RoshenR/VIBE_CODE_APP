import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, Clock, MapPin, Globe, Ticket } from 'lucide-react';
import { WaveLines } from '@/components/brand/wave-lines';
import { PublicShell } from '@/components/site/public-shell';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, InlineAlert } from '@/components/ui/states';
import { formatClock, formatLongDate, formatShort, zoneCity } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { getOffer, WaitlistError } from '@/server/waitlist';
import { OfferForm } from './offer-form';
import { isPaymentSimulated } from '@/lib/demo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "Une place s'est libérée",
  robots: { index: false, follow: false },
};

/**
 * Page d'acceptation d'une offre de liste d'attente.
 *
 * Le message insiste sur un point : les places sont RÉSERVÉES pendant tout le
 * délai. C'est la différence avec « premier arrivé, premier servi » — la personne
 * n'a pas à se précipiter en craignant de se faire doubler.
 */
export default async function OfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let offer;
  try {
    offer = await getOffer(token);
  } catch (err) {
    const message = err instanceof WaitlistError ? err.message : 'Cette offre est introuvable.';
    return (
      <PublicShell>
        <div className="page-container py-16">
          <div className="mx-auto max-w-xl">
            <EmptyState
              icon={Ticket}
              title={message}
              action={
                <ButtonLink href="/#programmation" variant="primary">
                  Voir la programmation
                </ButtonLink>
              }
            >
              Si le délai est dépassé, la place a été proposée à la personne suivante sur la liste.
              Vous pouvez vous réinscrire depuis la page de l&apos;événement.
            </EmptyState>
          </div>
        </div>
      </PublicShell>
    );
  }

  const { entry, event, ticketType } = offer;
  const total = ticketType.priceCents * entry.quantity;
  const place = event.isOnline ? 'En ligne' : (event.venueName ?? 'Lieu à préciser');
  const simulated = isPaymentSimulated();

  return (
    <PublicShell>
      <section className="surface-night grain relative overflow-hidden">
        <WaveLines
          className="pointer-events-none absolute right-0 bottom-0 h-full w-2/3 text-copper opacity-[0.2]"
          seed={21}
          envelope="right"
          lines={9}
        />
        <div className="page-container relative py-10 sm:py-14">
          <p className="eyebrow text-copper">Liste d&apos;attente</p>
          <h1 className="display text-display-lg mt-3 max-w-3xl">
            Une place s&apos;est libérée : c&apos;est votre tour
          </h1>
          <p className="text-on-night-soft mt-4 max-w-2xl text-lg">
            Ces places vous sont <strong className="text-on-night">réservées</strong> jusqu&apos;à
            l&apos;échéance ci-dessous. Personne d&apos;autre ne peut les prendre entre-temps.
          </p>
        </div>
      </section>

      <div className="page-container grid gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-14 lg:py-14">
        <div className="space-y-8">
          <InlineAlert tone="warning" title="À confirmer avant l'échéance">
            {entry.offerExpiresAt ? (
              <>
                Répondez avant le{' '}
                <strong>{formatShort(entry.offerExpiresAt, event.timezone)}</strong> (heure de{' '}
                {zoneCity(event.timezone)}). Passé ce délai, les places sont proposées à la personne
                suivante.
              </>
            ) : (
              'Passé le délai de réponse, les places sont proposées à la personne suivante.'
            )}
          </InlineAlert>

          <OfferForm
            token={token}
            defaultName={entry.name}
            defaultEmail={entry.email}
            holdMinutesCard={event.holdMinutesCard}
            holdHoursTransfer={event.holdHoursTransfer}
            simulated={simulated}
          />
        </div>

        <aside aria-labelledby="offre-recap" className="lg:sticky lg:top-6 lg:self-start">
          <div className="border-rule bg-paper shadow-panel rounded-panel border p-6">
            <h2 id="offre-recap" className="eyebrow text-ink-soft">
              Votre offre
            </h2>
            <p className="display text-display-sm mt-3">{event.title}</p>

            <ul className="text-ink-soft mt-3 space-y-2 text-[0.9375rem]">
              <li className="flex items-start gap-2.5">
                <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <span className="first-letter:uppercase">
                    {formatLongDate(event.startsAt, event.timezone)}
                  </span>
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{formatClock(event.startsAt, event.timezone)}</span>
              </li>
              <li className="flex items-start gap-2.5">
                {event.isOnline ? (
                  <Globe className="mt-0.5 size-4 shrink-0" aria-hidden />
                ) : (
                  <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                )}
                <span>{place}</span>
              </li>
            </ul>

            <div className="border-rule mt-5 flex justify-between gap-3 border-t pt-4 text-[0.9375rem]">
              <span>
                {entry.quantity} × {ticketType.name}
              </span>
              <span className="font-medium tabular-nums">{formatCents(total)}</span>
            </div>
            <div className="border-rule mt-4 flex items-baseline justify-between border-t pt-4">
              <span className="font-semibold">Total</span>
              <span className="display text-display-sm tabular-nums">{formatCents(total)}</span>
            </div>
          </div>

          <p className="mt-4 text-center text-sm">
            <Link
              href={`/e/${event.slug}`}
              className="text-ink-soft hover:text-ink inline-flex min-h-11 items-center underline underline-offset-4"
            >
              Voir la page de l&apos;événement
            </Link>
          </p>
        </aside>
      </div>
    </PublicShell>
  );
}
