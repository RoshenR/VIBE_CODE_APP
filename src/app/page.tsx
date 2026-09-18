import Link from 'next/link';
import { listPublishedEvents } from '@/server/catalog';
import { formatDateTime } from '@/lib/dates';
import { formatPrice } from '@/lib/money';
import { Badge, SiteFooter, SiteHeader } from './_components/chrome';

// Les compteurs de places changent en permanence : aucune mise en cache.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const events = await listPublishedEvents();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-ink-900 text-2xl font-semibold tracking-tight">
          Prochaines dates
        </h1>
        <p className="text-ink-500 mt-2 text-sm">
          Concerts et soirées à Bordeaux et alentours.
        </p>

        {events.length === 0 ? (
          <div className="border-ink-200 mt-8 rounded-2xl border border-dashed px-6 py-12 text-center">
            <p className="text-ink-600 font-medium">Aucune date à l&apos;affiche</p>
            <p className="text-ink-500 mt-1 text-sm">
              La programmation de la prochaine saison arrive bientôt.
            </p>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {events.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/e/${event.slug}`}
                  className="border-ink-200 hover:border-ink-400 block rounded-2xl border bg-white p-5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-ink-900 font-semibold">{event.title}</h2>
                      <p className="text-ink-500 mt-1 text-sm">
                        {formatDateTime(event.startsAt, event.timezone)}
                      </p>
                      <p className="text-ink-500 mt-0.5 truncate text-sm">
                        {event.isOnline
                          ? 'En ligne'
                          : (event.venueName ?? 'Lieu à préciser')}
                        {' · '}
                        <span className="text-ink-400">{event.organizationName}</span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {event.soldOut ? (
                        <Badge tone="danger">Complet</Badge>
                      ) : event.totalAvailable <= 10 ? (
                        <Badge tone="warn">
                          {event.totalAvailable} place{event.totalAvailable > 1 ? 's' : ''}
                        </Badge>
                      ) : (
                        <Badge tone="ok">Disponible</Badge>
                      )}
                      {event.fromPriceCents !== null && (
                        <p className="text-ink-600 mt-2 text-sm font-medium">
                          dès {formatPrice(event.fromPriceCents)}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
