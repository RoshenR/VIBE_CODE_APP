import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CalendarDays, CalendarOff, Clock, Globe, MapPin, SearchX } from 'lucide-react';
import { EventPoster } from '@/components/brand/event-poster';
import { WaveLines } from '@/components/brand/wave-lines';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import { EventCard } from '@/components/site/event-card';
import { EventTitle } from '@/components/site/event-title';
import { PublicShell } from '@/components/site/public-shell';
import { SalesBadge } from '@/components/site/sales-badge';
import { cn, stagger } from '@/lib/cn';
import { formatLongDate, zoneCity, zoneLabel, dateParts } from '@/lib/dates';
import {
  availableFilters,
  filterEvents,
  pickFeaturedEvent,
  type ProgrammeFilters,
} from '@/lib/programme';
import { listPublishedEvents, type PublicEventSummary } from '@/server/catalog';

// Les compteurs de places changent en permanence : aucune mise en cache.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'Les Nuits de la Garonne — Concerts et soirées à Bordeaux' },
  description:
    'Concerts et soirées à Bordeaux et alentours. Choisissez votre date, réservez vos places en quelques secondes et retrouvez vos billets par e-mail.',
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<ProgrammeFilters>;
}) {
  const params = await searchParams;
  const events = await listPublishedEvents();

  const featured = pickFeaturedEvent(events);
  const filters = availableFilters(events);
  const visible = filterEvents(events, params);
  const filtered = Boolean(params.format || params.collectif);

  return (
    <PublicShell>
      {featured ? <FeaturedHero event={featured} total={events.length} /> : <EmptyHero />}

      <section
        id="programmation"
        aria-labelledby="programmation-titre"
        className="page-container pt-16 pb-24 lg:pt-24"
      >
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
          <div>
            <p className="eyebrow text-copper-ink">À l&apos;affiche</p>
            <h2 id="programmation-titre" className="display mt-2 text-display-lg">
              Programmation
            </h2>
            <p className="mt-3 text-ink-soft" aria-live="polite">
              {events.length === 0
                ? 'Aucun concert à venir.'
                : filtered
                  ? `${visible.length} concert${visible.length > 1 ? 's' : ''} sur ${events.length}`
                  : `${events.length} concert${events.length > 1 ? 's' : ''} à venir`}
            </p>
          </div>

          <Filters params={params} filters={filters} />
        </div>

        <div className="mt-12">
          {events.length === 0 ? (
            <EmptyState icon={CalendarOff} title="Aucun concert à l'affiche pour le moment">
              Les nouveaux concerts apparaîtront ici dès leur mise en vente.
            </EmptyState>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Aucun concert ne correspond à ces filtres"
              action={
                <ButtonLink href="/#programmation" variant="secondary">
                  Voir toute la programmation
                </ButtonLink>
              }
            >
              Essayez un autre format ou un autre collectif.
            </EmptyState>
          ) : (
            <ul className="grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-10">
              {visible.map((event, i) => (
                <li
                  key={event.id}
                  className="reveal lg:nth-[3n+2]:mt-12"
                  style={stagger(Math.min(i, 5))}
                >
                  <EventCard event={event} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </PublicShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Premier écran                                                              */
/* -------------------------------------------------------------------------- */

function FeaturedHero({ event, total }: { event: PublicEventSummary; total: number }) {
  const d = dateParts(event.startsAt, event.timezone);
  const place = event.isOnline ? 'En ligne' : (event.venueName ?? 'Lieu à préciser');
  const canBook = event.salesState === 'open';

  return (
    <section className="surface-night grain relative overflow-hidden">
      {/* La signature, derrière l'affiche : elle déborde, elle ne recouvre rien. */}
      <WaveLines
        className="pointer-events-none absolute top-1/2 right-0 hidden h-[78%] w-[62%] -translate-y-1/2 text-copper opacity-[0.28] lg:block"
        seed={3}
        envelope="right"
        lines={13}
        amplitude={1.05}
      />

      <div className="page-container relative grid items-center gap-12 py-12 sm:py-16 lg:min-h-[min(74svh,700px)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16">
        <div>
          <p className="eyebrow reveal text-copper" style={stagger(0)}>
            Les nuits se vivent ici.
          </p>
          <p className="eyebrow reveal mt-7 text-on-night-soft" style={stagger(1)}>
            Prochain concert
          </p>

          <h1
            className="display reveal mt-3 text-display-xl text-on-night"
            style={stagger(2)}
          >
            <EventTitle title={event.title} />
          </h1>

          <ul
            className="reveal mt-8 flex flex-col gap-3 text-[1.0625rem] sm:flex-row sm:flex-wrap sm:gap-x-8"
            style={stagger(3)}
          >
            <li className="flex items-center gap-2.5">
              <CalendarDays className="size-5 shrink-0 text-copper" aria-hidden />
              <span className="first-letter:uppercase">
                {formatLongDate(event.startsAt, event.timezone)}
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <Clock className="size-5 shrink-0 text-copper" aria-hidden />
              <span>
                {d.clock}{' '}
                <span className="text-on-night-muted">
                  · heure de {zoneCity(event.timezone)} ({zoneLabel(event.startsAt, event.timezone)})
                </span>
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              {event.isOnline ? (
                <Globe className="size-5 shrink-0 text-copper" aria-hidden />
              ) : (
                <MapPin className="size-5 shrink-0 text-copper" aria-hidden />
              )}
              <span>{place}</span>
            </li>
          </ul>

          <div
            className="reveal mt-9 flex flex-col items-start gap-x-6 gap-y-5 sm:flex-row sm:items-center"
            style={stagger(4)}
          >
            <ButtonLink
              href={`/e/${event.slug}${canBook ? '#reserver' : ''}`}
              size="lg"
              tone="night"
              className="group w-full sm:w-auto"
            >
              {canBook ? 'Réserver mes places' : 'Voir le concert'}
              <ArrowRight
                className="size-5 transition-transform duration-200 group-hover:translate-x-1"
                aria-hidden
              />
            </ButtonLink>

            <SalesBadge
              surface="night"
              state={event.salesState}
              available={event.totalAvailable}
              opensAt={event.opensAt}
              timezone={event.timezone}
            />
          </div>

          {total > 1 && (
            <Link
              href="/#programmation"
              className="reveal mt-8 inline-flex min-h-11 items-center gap-2 text-[0.9375rem] font-medium text-on-night-soft underline decoration-night-rule-strong underline-offset-[6px] transition-colors hover:text-on-night hover:decoration-copper"
              style={stagger(5)}
            >
              Voir les {total} concerts à l&apos;affiche
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>

        <div className="reveal relative mx-auto w-full max-w-[24rem] lg:max-w-[28rem]" style={stagger(2)}>
          <Link
            href={`/e/${event.slug}`}
            tabIndex={-1}
            aria-hidden="true"
            className="block transition-transform duration-300 ease-out-soft hover:-translate-y-1.5 focus-visible:outline-none"
          >
            <EventPoster
              title={event.title}
              slug={event.slug}
              startsAt={event.startsAt}
              timezone={event.timezone}
              collectif={event.organizationName}
              place={place}
              className="rotate-[1.2deg]"
            />
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Aucun concert à venir : l'accroche prend toute la place, sans rien fabriquer. */
function EmptyHero() {
  return (
    <section className="surface-night grain relative overflow-hidden">
      <WaveLines
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[60%] text-copper opacity-30"
        seed={5}
        lines={12}
        amplitude={1.1}
      />
      <div className="page-container relative py-20 sm:py-28 lg:min-h-[min(60svh,520px)]">
        <h1 className="display reveal max-w-4xl text-display-2xl text-on-night">
          Les nuits <span className="text-copper">se vivent</span> ici.
        </h1>
        <p className="reveal mt-6 max-w-xl text-lg text-on-night-soft" style={stagger(2)}>
          La prochaine programmation n&apos;est pas encore publiée. Les concerts apparaîtront ici dès
          leur mise en vente.
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Filtres                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Filtres de la programmation, proposés uniquement s'ils changent quelque chose
 * (voir `availableFilters`) et rendus comme de simples liens : ils fonctionnent
 * sans JavaScript, se partagent par URL et laissent l'historique du navigateur
 * en état.
 */
function Filters({
  params,
  filters,
}: {
  params: ProgrammeFilters;
  filters: ReturnType<typeof availableFilters>;
}) {
  if (!filters.canFilterByFormat && filters.collectifs.length === 0) return null;

  const href = (next: ProgrammeFilters) => {
    const q = new URLSearchParams();
    const merged = { ...params, ...next };
    if (merged.format) q.set('format', merged.format);
    if (merged.collectif) q.set('collectif', merged.collectif);
    const query = q.toString();
    return `/${query ? `?${query}` : ''}#programmation`;
  };

  return (
    <nav aria-label="Filtres de la programmation" className="flex flex-col gap-4 sm:items-end">
      {filters.canFilterByFormat && (
        <FilterGroup label="Format">
          <Chip href={href({ format: undefined })} active={!params.format}>
            Tous
          </Chip>
          <Chip href={href({ format: 'venue' })} active={params.format === 'venue'}>
            Sur place
          </Chip>
          <Chip href={href({ format: 'online' })} active={params.format === 'online'}>
            En ligne
          </Chip>
        </FilterGroup>
      )}
      {filters.collectifs.length > 0 && (
        <FilterGroup label="Collectif">
          <Chip href={href({ collectif: undefined })} active={!params.collectif}>
            Tous
          </Chip>
          {filters.collectifs.map((c) => (
            <Chip key={c.slug} href={href({ collectif: c.slug })} active={params.collectif === c.slug}>
              {c.name}
            </Chip>
          ))}
        </FilterGroup>
      )}
    </nav>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="eyebrow mr-1 text-ink-muted">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'inline-flex h-11 items-center rounded-control border px-4 text-[0.9375rem] font-semibold transition-colors duration-150',
        active
          ? 'border-ink bg-ink text-canvas'
          : 'border-rule-strong bg-transparent text-ink hover:border-ink hover:bg-sunken',
      )}
    >
      {children}
    </Link>
  );
}
