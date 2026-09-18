import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { ticketTypes } from '@/db/schema';
import { requireEvent } from '@/lib/org';
import { toLocalInputValue } from '@/lib/dates';
import { updateEventAction } from '../../event-actions';
import { EventForm } from '../../event-form';
import { TicketTypesEditor } from './ticket-types-editor';
import { PublishControls } from './publish-controls';

export const dynamic = 'force-dynamic';

export default async function EventSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { event } = await requireEvent(id);

  const types = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, id))
    .orderBy(asc(ticketTypes.position));

  // Le formulaire est lié par un `key` au fuseau : changer de fuseau doit
  // réinitialiser les champs d'heure, qui n'ont plus le même sens.
  const boundUpdate = updateEventAction.bind(null, id);

  return (
    <div>
      <Link
        href={`/admin/evenements/${id}`}
        className="text-ink-500 hover:text-ink-800 text-sm"
      >
        ← {event.title}
      </Link>
      <h1 className="text-ink-900 mt-1 text-xl font-semibold tracking-tight">Réglages</h1>

      <PublishControls eventId={id} status={event.status} hasTicketTypes={types.length > 0} />

      <section className="mt-8">
        <h2 className="text-ink-900 font-semibold">Catégories de places</h2>
        <p className="text-ink-500 mt-1 text-sm">
          Fosse et balcon, standard et VIP… Chaque catégorie a son prix et sa jauge
          propres. Une jauge ne peut jamais descendre sous le nombre de places déjà
          réservées.
        </p>
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
      </section>

      <section className="mt-10">
        <h2 className="text-ink-900 font-semibold">Informations de l&apos;événement</h2>
        <EventForm
          action={boundUpdate}
          submitLabel="Enregistrer"
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
      </section>
    </div>
  );
}
