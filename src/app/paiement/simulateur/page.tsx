import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { events, orders } from '@/db/schema';
import { formatCents } from '@/lib/money';
import { SimulatorPanel } from './panel';

export const dynamic = 'force-dynamic';

/**
 * Page de paiement du prestataire factice.
 *
 * Elle remplace la page d'un vrai prestataire et permet surtout de rejouer une
 * notification à l'identique — le scénario qui a produit deux billets pour un
 * seul paiement chez le client.
 */
export default async function SimulatorPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; order?: string }>;
}) {
  const { ref, order: orderId } = await searchParams;
  if (!orderId) notFound();

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) notFound();

  const [event] = await db.select().from(events).where(eq(events.id, order.eventId)).limit(1);

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <div className="rounded-2xl border border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Environnement de test.</strong> Ceci remplace la page de votre
        prestataire de paiement. Aucun argent n&apos;est débité.
      </div>

      <section className="border-ink-200 mt-5 rounded-2xl border bg-white p-6">
        <h1 className="text-ink-900 text-lg font-semibold">Paiement</h1>
        <dl className="text-ink-600 mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt>Événement</dt>
            <dd className="text-ink-900 font-medium">{event?.title ?? '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Référence</dt>
            <dd className="text-ink-900 font-mono">{order.reference}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Montant</dt>
            <dd className="text-ink-900 text-base font-semibold">
              {formatCents(order.totalCents, order.currency)}
            </dd>
          </div>
        </dl>

        <SimulatorPanel
          orderId={order.id}
          providerRef={ref ?? ''}
          manageToken={order.manageToken}
          alreadyPaid={order.status === 'paid'}
        />
      </section>
    </main>
  );
}
