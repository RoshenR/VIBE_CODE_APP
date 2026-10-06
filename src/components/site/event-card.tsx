import Link from 'next/link';
import { EventPoster } from '@/components/brand/event-poster';
import { SalesBadge } from './sales-badge';
import { dateParts } from '@/lib/dates';
import { formatPrice } from '@/lib/money';
import type { PublicEventSummary } from '@/server/catalog';

/**
 * Entrée de la programmation : l'affiche, un bloc de date très lisible, le titre
 * et des métadonnées calmes.
 *
 * Les informations comparables (date, lieu, état, prix) sont toujours au même
 * endroit d'une carte à l'autre ; seule l'affiche varie. Le lien couvre toute la
 * carte (pseudo-élément étiré sur le titre) sans dupliquer la destination pour
 * les lecteurs d'écran.
 */
export function EventCard({ event }: { event: PublicEventSummary }) {
  const d = dateParts(event.startsAt, event.timezone);
  const place = event.isOnline ? 'En ligne' : (event.venueName ?? 'Lieu à préciser');

  return (
    <article className="group relative flex flex-col gap-5">
      <div className="transition-transform duration-300 ease-out-soft group-hover:-translate-y-1.5 group-has-[a:focus-visible]:outline-[3px] group-has-[a:focus-visible]:outline-offset-4 group-has-[a:focus-visible]:outline-ink">
        <EventPoster
          title={event.title}
          slug={event.slug}
          startsAt={event.startsAt}
          timezone={event.timezone}
          collectif={event.organizationName}
          place={place}
        />
      </div>

      <div className="flex gap-4">
        {/* Bloc de date : se repère d'un coup d'œil, en colonne de gauche. */}
        <div className="w-14 shrink-0 border-r border-rule pr-4 text-center" aria-hidden="true">
          <p className="eyebrow text-ink-soft">{d.weekdayShort}</p>
          <p className="display mt-0.5 text-[2.5rem] leading-[0.9] tabular-nums">{d.day}</p>
          <p className="eyebrow mt-1 text-copper-ink">{d.monthShort}</p>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="display text-display-sm">
            <Link
              href={`/e/${event.slug}`}
              className="after:absolute after:inset-0 focus-visible:outline-none"
            >
              {event.title}
            </Link>
          </h3>
          <p className="mt-1.5 text-[0.9375rem] text-ink-soft">
            <span className="sr-only">{d.weekday} {d.day} {d.month}, </span>
            {d.clock} · {place}
          </p>
          <p className="text-sm text-ink-muted">{event.organizationName}</p>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <SalesBadge
              state={event.salesState}
              available={event.totalAvailable}
              opensAt={event.opensAt}
              timezone={event.timezone}
            />
            {event.fromPriceCents !== null && event.salesState !== 'closed' && (
              <span className="text-sm font-semibold tabular-nums">
                {event.fromPriceCents === 0 ? 'Gratuit' : `dès ${formatPrice(event.fromPriceCents)}`}
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
