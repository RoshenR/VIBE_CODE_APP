import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db';
import { getOrderDetail } from '@/server/orders';
import { formatCents } from '@/lib/money';
import { formatDateTime, zoneLabel } from '@/lib/dates';
import { Badge, SiteFooter, SiteHeader } from '@/app/_components/chrome';
import { TicketList } from './ticket-list';
import { CancelButton } from './cancel-button';
import { HoldCountdown } from './hold-countdown';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' }> = {
  pending: { label: 'En attente de paiement', tone: 'warn' },
  paid: { label: 'Payée', tone: 'ok' },
  expired: { label: 'Expirée', tone: 'danger' },
  cancelled: { label: 'Annulée', tone: 'danger' },
  refunded: { label: 'Remboursée', tone: 'danger' },
};

/**
 * Page de gestion d'une commande.
 *
 * Accessible par un jeton aléatoire reçu par e-mail : pas de compte à créer pour
 * le public. C'est ici que se fait l'annulation autonome demandée dans le brief.
 */
export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const detail = await getOrderDetail(db, { manageToken: token });
  if (!detail) notFound();

  const { order, event, items, tickets } = detail;
  const status = STATUS_LABEL[order.status] ?? { label: order.status, tone: 'warn' as const };

  const cancellationDeadline = new Date(
    event.startsAt.getTime() - event.cancellationDeadlineHours * 3_600_000,
  );
  const canCancel =
    (order.status === 'paid' || order.status === 'pending') && new Date() < cancellationDeadline;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-ink-500 text-sm">Commande</p>
            <h1 className="font-mono text-xl font-semibold tracking-tight">
              {order.reference}
            </h1>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>

        <section className="border-ink-200 mt-6 rounded-2xl border bg-white p-5">
          <h2 className="text-ink-900 font-semibold">{event.title}</h2>
          <p className="text-ink-600 mt-1 text-sm">
            {formatDateTime(event.startsAt, event.timezone)}{' '}
            <span className="text-ink-400">({zoneLabel(event.startsAt, event.timezone)})</span>
          </p>
          <p className="text-ink-600 mt-0.5 text-sm">
            {event.isOnline
              ? 'Événement en ligne'
              : `${event.venueName ?? ''}${event.venueAddress ? ` — ${event.venueAddress}` : ''}`}
          </p>

          <ul className="border-ink-200 mt-4 divide-y border-t pt-2">
            {items.map((item, i) => (
              <li key={i} className="flex justify-between py-2 text-sm">
                <span className="text-ink-700">
                  {item.quantity} × {item.ticketTypeName}
                  {item.appliedPrice === 'early' && (
                    <span className="ml-2 text-xs font-medium text-emerald-700">early</span>
                  )}
                </span>
                <span className="font-medium tabular-nums">
                  {formatCents(item.subtotalCents, order.currency)}
                </span>
              </li>
            ))}
            <li className="flex justify-between py-2 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">
                {formatCents(order.totalCents, order.currency)}
              </span>
            </li>
          </ul>
        </section>

        {order.status === 'pending' && order.holdExpiresAt && (
          <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h2 className="font-semibold text-amber-900">Réservation à régler</h2>
            <p className="mt-1 text-sm text-amber-800">
              {order.paymentMethod === 'transfer'
                ? 'Vos places sont bloquées le temps que le virement nous parvienne.'
                : 'Vos places sont bloquées le temps du paiement.'}
            </p>
            <HoldCountdown expiresAtIso={order.holdExpiresAt.toISOString()} />
            <Link
              href={`/paiement/relance?order=${order.id}`}
              className="mt-4 inline-block rounded-xl bg-amber-900 px-5 py-3 font-semibold text-white"
            >
              Procéder au paiement
            </Link>
          </section>
        )}

        {order.status === 'paid' && tickets.length > 0 && (
          <section className="mt-5">
            <h2 className="text-ink-900 font-semibold">
              Vos billets ({tickets.length})
            </h2>
            <p className="text-ink-500 mt-1 text-sm">
              Présentez chaque QR code à l&apos;entrée. Un billet n&apos;est valable
              qu&apos;une seule fois&nbsp;: une capture d&apos;écran partagée sera
              refusée au second passage.
            </p>
            <TicketList tickets={tickets} manageToken={token} />
          </section>
        )}

        {canCancel && (
          <section className="border-ink-200 mt-8 rounded-2xl border p-5">
            <h2 className="text-ink-900 font-semibold">Annuler ma commande</h2>
            <p className="text-ink-600 mt-1 text-sm">
              Possible jusqu&apos;au{' '}
              {formatDateTime(cancellationDeadline, event.timezone)}. Vos places
              repartiront à la vente et seront proposées à la liste d&apos;attente.
            </p>
            <CancelButton token={token} wasPaid={order.status === 'paid'} />
          </section>
        )}

        {!canCancel && (order.status === 'paid' || order.status === 'pending') && (
          <p className="text-ink-500 mt-8 text-sm">
            L&apos;annulation en ligne n&apos;est plus possible&nbsp;: le délai de{' '}
            {event.cancellationDeadlineHours} h avant le début est dépassé. Écrivez-nous
            si vous avez un empêchement.
          </p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
