import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, CalendarDays, Clock, Globe, Mail, MapPin } from 'lucide-react';
import { db } from '@/db';
import { WaveLines } from '@/components/brand/wave-lines';
import { PublicShell } from '@/components/site/public-shell';
import { TicketCard } from '@/components/site/ticket-card';
import { StatusBadge, type Tone } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { InlineAlert } from '@/components/ui/states';
import { isPaymentSimulated } from '@/lib/demo';
import { formatClock, formatLongDate, formatShort, zoneCity } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { getOrderDetail } from '@/server/orders';
import { CancelButton } from './cancel-button';
import { HoldCountdown } from './hold-countdown';

export const dynamic = 'force-dynamic';

// La page porte un jeton d'accès dans son URL : jamais d'indexation.
export const metadata: Metadata = {
  title: 'Ma commande',
  robots: { index: false, follow: false },
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'En attente de paiement', tone: 'warning' },
  paid: { label: 'Payée', tone: 'success' },
  expired: { label: 'Expirée', tone: 'neutral' },
  cancelled: { label: 'Annulée', tone: 'danger' },
  refunded: { label: 'Annulée — remboursement enregistré', tone: 'danger' },
};

const METHOD: Record<string, string> = {
  card: 'Carte bancaire',
  transfer: 'Virement bancaire',
  free: 'Gratuit',
};

/**
 * Page de gestion d'une commande.
 *
 * Accessible par un jeton aléatoire reçu par e-mail : pas de compte à créer pour
 * le public. C'est ici que se retrouvent les billets et que se fait l'annulation
 * autonome.
 */
export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const detail = await getOrderDetail(db, { manageToken: token });
  if (!detail) notFound();

  const { order, event, items, tickets } = detail;
  // Une commande gratuite n'a rien à rembourser : on ne parle pas de remboursement.
  const hasPayment = order.totalCents > 0;
  const status =
    order.status === 'refunded' && !hasPayment
      ? STATUS.cancelled
      : (STATUS[order.status] ?? { label: order.status, tone: 'neutral' as Tone });
  const simulated = isPaymentSimulated();

  const cancellationDeadline = new Date(
    event.startsAt.getTime() - event.cancellationDeadlineHours * 3_600_000,
  );
  const cancellable = order.status === 'paid' || order.status === 'pending';
  const canCancel = cancellable && new Date() < cancellationDeadline;
  const place = event.isOnline ? 'En ligne' : (event.venueName ?? 'Lieu à préciser');

  return (
    <PublicShell>
      <section className="surface-night grain relative overflow-hidden">
        <WaveLines
          className="pointer-events-none absolute right-0 bottom-0 h-full w-2/3 text-copper opacity-[0.18]"
          seed={12}
          envelope="right"
          lines={9}
        />
        <div className="page-container relative py-10 sm:py-14">
          <p className="eyebrow text-copper">Commande</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-4">
            <h1 className="display text-display-lg tabular-nums">{order.reference}</h1>
            <StatusBadge surface="night" tone={status.tone}>
              {status.label}
            </StatusBadge>
          </div>
          <p className="text-on-night-soft mt-4 text-lg">{event.title}</p>
        </div>
      </section>

      <div className="page-container grid gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-14 lg:py-14">
        <div className="space-y-10">
          {/* ------------------------------------------------ Réservation à régler */}
          {order.status === 'pending' && (
            <section
              aria-labelledby="paiement-titre"
              className="border-warning-ink/45 bg-warning-wash text-warning-ink rounded-panel border-2 p-6 sm:p-7"
            >
              <h2 id="paiement-titre" className="display text-display-md">
                Réservation à régler
              </h2>
              <p className="mt-3 text-[1.0625rem]">
                {order.paymentMethod === 'transfer'
                  ? 'Vos places sont bloquées le temps que votre virement nous parvienne.'
                  : 'Vos places sont bloquées le temps du paiement.'}
              </p>

              {order.holdExpiresAt && (
                <>
                  <p className="mt-4 flex items-start gap-2 text-[0.9375rem]">
                    <Clock className="mt-0.5 size-5 shrink-0" aria-hidden />
                    <span>
                      À régler avant le{' '}
                      <strong>
                        {formatShort(order.holdExpiresAt, event.timezone)}
                      </strong>{' '}
                      (heure de {zoneCity(event.timezone)}).
                    </span>
                  </p>
                  <HoldCountdown expiresAtIso={order.holdExpiresAt.toISOString()} />
                </>
              )}

              {simulated && (
                <p className="mt-4 text-[0.9375rem] font-medium">
                  Mode démonstration : la page suivante simule le paiement, aucun montant n&apos;est
                  débité.
                </p>
              )}

              <ButtonLink
                href={`/paiement/relance?order=${order.id}`}
                prefetch={false}
                variant="solid"
                size="lg"
                className="mt-6 w-full sm:w-auto"
              >
                Procéder au paiement
                <ArrowRight className="size-5" aria-hidden />
              </ButtonLink>
            </section>
          )}

          {/* ----------------------------------------------------------- Billets */}
          {order.status === 'paid' && tickets.length > 0 && (
            <section aria-labelledby="billets-titre">
              <h2 id="billets-titre" className="display text-display-md">
                {tickets.length > 1 ? `Vos ${tickets.length} billets` : 'Votre billet'}
              </h2>
              <p className="text-ink-soft measure mt-3">
                Présentez chaque QR code à l&apos;entrée. Un billet n&apos;est valable qu&apos;une
                seule fois : une capture d&apos;écran partagée sera refusée au second passage.
              </p>

              <ul className="mt-7 space-y-6">
                {tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <TicketCard
                      ticket={ticket}
                      manageToken={token}
                      event={{
                        title: event.title,
                        startsAt: event.startsAt,
                        timezone: event.timezone,
                        isOnline: event.isOnline,
                        venueName: event.venueName,
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ------------------------------------------ Commande close ou annulée */}
          {order.status === 'expired' && (
            <InlineAlert tone="warning" title="Cette réservation a expiré.">
              <p>
                Elle n&apos;a pas été réglée avant l&apos;échéance, et les places ont été remises en
                vente. Aucun montant n&apos;a été débité.
              </p>
              <p className="mt-3">
                <Link
                  href={`/e/${event.slug}`}
                  className="inline-flex min-h-11 items-center gap-2 font-semibold underline underline-offset-4"
                >
                  Revoir l&apos;événement et réserver à nouveau
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </p>
            </InlineAlert>
          )}

          {(order.status === 'cancelled' || (order.status === 'refunded' && !hasPayment)) && (
            <InlineAlert tone="danger" title="Cette commande a été annulée.">
              Aucun montant n&apos;a été débité. Les places ont été remises en vente.
            </InlineAlert>
          )}

          {order.status === 'refunded' && hasPayment && (
            <InlineAlert tone="danger" title="Cette commande a été annulée.">
              L&apos;annulation est enregistrée et vos billets ne sont plus valables. Le
              remboursement de {formatCents(order.totalCents, order.currency)} est effectué par
              l&apos;équipe organisatrice : il n&apos;est pas automatique.
            </InlineAlert>
          )}

          {/* --------------------------------------------------------- Annulation */}
          {canCancel && (
            <section
              aria-labelledby="annulation-titre"
              className="border-rule bg-paper rounded-panel border p-6"
            >
              <h2 id="annulation-titre" className="text-lg font-semibold">
                Un empêchement ?
              </h2>
              <p className="text-ink-soft mt-2 text-[0.9375rem]">
                Vous pouvez annuler en ligne jusqu&apos;au{' '}
                <strong>{formatShort(cancellationDeadline, event.timezone)}</strong>. Vos places
                repartent alors à la vente et sont proposées à la liste d&apos;attente.
              </p>
              <div className="mt-4">
                <CancelButton token={token} wasPaid={order.status === 'paid' && hasPayment} />
              </div>
            </section>
          )}

          {!canCancel && cancellable && (
            <InlineAlert tone="info" title="L'annulation en ligne n'est plus possible.">
              Le délai de {event.cancellationDeadlineHours} h avant le début est dépassé. En cas
              d&apos;empêchement, répondez à l&apos;e-mail de confirmation.
            </InlineAlert>
          )}
        </div>

        {/* ------------------------------------------------------- Récapitulatif */}
        <aside aria-labelledby="recap-titre" className="lg:sticky lg:top-6 lg:self-start">
          <div className="border-rule bg-paper shadow-panel rounded-panel border p-6">
            <h2 id="recap-titre" className="eyebrow text-ink-soft">
              Récapitulatif
            </h2>

            <p className="display text-display-sm mt-3">{event.title}</p>
            <ul className="text-ink-soft mt-3 space-y-2 text-[0.9375rem]">
              <li className="flex items-start gap-2.5">
                <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <span className="first-letter:uppercase">
                    {formatLongDate(event.startsAt, event.timezone)}
                  </span>{' '}
                  · {formatClock(event.startsAt, event.timezone)}
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                {event.isOnline ? (
                  <Globe className="mt-0.5 size-4 shrink-0" aria-hidden />
                ) : (
                  <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                )}
                <span>{place}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="break-all">{order.customerEmail}</span>
              </li>
            </ul>

            <ul className="border-rule mt-5 space-y-2 border-t pt-4 text-[0.9375rem]">
              {items.map((item, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>
                    {item.quantity} × {item.ticketTypeName}
                    {item.appliedPrice === 'early' && (
                      <span className="text-copper-ink"> · tarif early</span>
                    )}
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatCents(item.subtotalCents, order.currency)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="border-rule mt-4 flex items-baseline justify-between border-t pt-4">
              <span className="font-semibold">Total</span>
              <span className="display text-display-sm tabular-nums">
                {formatCents(order.totalCents, order.currency)}
              </span>
            </div>

            <p className="text-ink-muted mt-4 text-sm">
              {METHOD[order.paymentMethod] ?? order.paymentMethod}
              {order.status === 'paid' && order.paidAt
                ? ` · réglé le ${formatShort(order.paidAt, event.timezone)}`
                : ''}
              {simulated && order.paymentMethod !== 'free' ? ' · paiement simulé' : ''}
            </p>
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
