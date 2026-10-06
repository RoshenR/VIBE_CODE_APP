import type { Metadata } from 'next';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { ticketTypes } from '@/db/schema';
import { toLocalInputValue } from '@/lib/dates';
import { requireEvent } from '@/lib/org';
import { updateEventAction } from '../../event-actions';
import { EventForm } from '../../event-form';
import { PublishControls } from './publish-controls';
import { TicketTypesEditor } from './ticket-types-editor';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Réglages' };

/**
 * Réglages d'un événement. Réservés aux responsables : `requireEvent` exige le
 * droit de modification, et chaque action serveur le revérifie.
 */
export default async function EventSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event } = await requireEvent(id, 'evenement.modifier');

  const types = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, id))
    .orderBy(asc(ticketTypes.position));

  const boundUpdate = updateEventAction.bind(null, id);

  return (
    <div className="max-w-3xl space-y-12">
      <PublishControls
        eventId={id}
        slug={event.slug}
        status={event.status}
        hasTicketTypes={types.length > 0}
      />

      <section aria-labelledby="categories-titre">
        <h2 id="categories-titre" className="display text-display-md">
          Catégories de places
        </h2>
        <p className="text-ink-soft measure mt-2">
          Fosse et balcon, standard et VIP… Chaque catégorie a son prix et sa jauge. La jauge ne peut
          jamais descendre sous le nombre de places déjà retenues ou vendues.
        </p>
        <div className="mt-6">
          <TicketTypesEditor
            eventId={id}
            ticketTypes={types.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              priceEuros: (t.priceCents / 100).toFixed(2),
              earlyPriceEuros: t.earlyPriceCents ? (t.earlyPriceCents / 100).toFixed(2) : '',
              earlyEndsAt: t.earlyEndsAt ? toLocalInputValue(t.earlyEndsAt, event.timezone) : '',
              quantityTotal: t.quantityTotal,
              quantityReserved: t.quantityReserved,
              quantitySold: t.quantitySold,
              maxPerOrder: t.maxPerOrder,
            }))}
          />
        </div>
      </section>

      <section aria-labelledby="infos-titre">
        <h2 id="infos-titre" className="display text-display-md">
          Informations de l&apos;événement
        </h2>
        <div className="mt-6">
          <EventForm
            action={boundUpdate}
            submitLabel="Enregistrer les modifications"
            initial={{
              title: event.title,
              description: event.description,
              venueName: event.venueName ?? '',
              venueAddress: event.venueAddress ?? '',
              isOnline: event.isOnline,
              onlineUrl: event.onlineUrl ?? '',
              timezone: event.timezone,
              startsAt: toLocalInputValue(event.startsAt, event.timezone),
              doorsAt: event.doorsAt ? toLocalInputValue(event.doorsAt, event.timezone) : '',
              holdMinutesCard: event.holdMinutesCard,
              holdHoursTransfer: event.holdHoursTransfer,
              waitlistOfferHours: event.waitlistOfferHours,
              cancellationDeadlineHours: event.cancellationDeadlineHours,
            }}
          />
        </div>
      </section>
    </div>
  );
}
