import { getOffer, WaitlistError } from '@/server/waitlist';
import { formatCents } from '@/lib/money';
import { formatDateTime, zoneLabel } from '@/lib/dates';
import { Alert, SiteFooter, SiteHeader } from '@/app/_components/chrome';
import { OfferForm } from './offer-form';

export const dynamic = 'force-dynamic';

/**
 * Page d'acceptation d'une offre de liste d'attente.
 *
 * Le message insiste sur un point : les places sont réservées pendant tout le
 * délai. C'est la différence avec « premier arrivé, premier servi » — la personne
 * n'a pas à se précipiter en craignant de se faire doubler.
 */
export default async function OfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let offer;
  try {
    offer = await getOffer(token);
  } catch (err) {
    const message =
      err instanceof WaitlistError ? err.message : 'Cette offre est introuvable.';
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-lg px-4 py-10">
          <Alert tone="warn">{message}</Alert>
          <p className="text-ink-600 mt-4 text-sm">
            Si le délai est dépassé, la place a été proposée à la personne suivante sur
            la liste. Vous pouvez vous réinscrire sur la page de l&apos;événement.
          </p>
        </main>
        <SiteFooter />
      </>
    );
  }

  const { entry, event, ticketType } = offer;
  const total = ticketType.priceCents * entry.quantity;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-lg px-4 py-10">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <h1 className="font-semibold text-emerald-900">
            Une place se libère — c&apos;est votre tour
          </h1>
          <p className="mt-1 text-sm text-emerald-800">
            Ces places vous sont <strong>réservées</strong> jusqu&apos;à l&apos;échéance
            ci-dessous. Personne d&apos;autre ne peut les prendre entre-temps.
          </p>
        </div>

        <section className="border-ink-200 mt-5 rounded-2xl border bg-white p-5">
          <h2 className="text-ink-900 font-semibold">{event.title}</h2>
          <p className="text-ink-600 mt-1 text-sm">
            {formatDateTime(event.startsAt, event.timezone)}{' '}
            <span className="text-ink-400">({zoneLabel(event.startsAt, event.timezone)})</span>
          </p>

          <dl className="border-ink-200 mt-4 space-y-2 border-t pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-500">Catégorie</dt>
              <dd className="font-medium">{ticketType.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-500">Quantité</dt>
              <dd className="font-medium">{entry.quantity}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-500">À confirmer avant</dt>
              <dd className="font-medium">
                {entry.offerExpiresAt
                  ? formatDateTime(entry.offerExpiresAt, event.timezone)
                  : '—'}
              </dd>
            </div>
            <div className="flex justify-between pt-1 text-base">
              <dt className="font-semibold">Total</dt>
              <dd className="font-semibold tabular-nums">{formatCents(total)}</dd>
            </div>
          </dl>
        </section>

        <OfferForm token={token} defaultName={entry.name} defaultEmail={entry.email} />
      </main>
      <SiteFooter />
    </>
  );
}
