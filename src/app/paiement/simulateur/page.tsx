import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { FlaskConical } from 'lucide-react';
import { db } from '@/db';
import { events, orders } from '@/db/schema';
import { PublicShell } from '@/components/site/public-shell';
import { StatusBadge } from '@/components/ui/badge';
import { formatCents } from '@/lib/money';
import { SimulatorPanel } from './panel';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Paiement — mode démonstration',
  robots: { index: false, follow: false },
};

/**
 * Page de paiement du prestataire factice.
 *
 * Elle remplace la page d'un vrai prestataire. Son premier rôle est d'être sans
 * ambiguïté : rien n'est débité, et cela se lit avant tout le reste. Son second
 * est de permettre de rejouer une notification à l'identique — le scénario qui
 * a produit deux billets pour un seul paiement chez le client.
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
    <PublicShell>
      <div className="page-container py-10 sm:py-14">
        <div className="mx-auto max-w-xl">
          <div className="border-warning-ink/45 bg-warning-wash text-warning-ink flex items-start gap-3 rounded-panel border-2 px-5 py-4">
            <FlaskConical className="mt-0.5 size-6 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">Mode démonstration — paiement simulé</p>
              <p className="mt-1 text-[0.9375rem]">
                Cette page remplace celle d&apos;un prestataire de paiement. Aucun montant n&apos;est
                débité et aucune carte n&apos;est demandée.
              </p>
            </div>
          </div>

          <section
            aria-labelledby="paiement-titre"
            className="border-rule bg-paper shadow-lift mt-6 rounded-panel border p-6 sm:p-8"
          >
            <h1 id="paiement-titre" className="display text-display-lg">
              Paiement
            </h1>

            <dl className="mt-6 space-y-3 text-[0.9375rem]">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Événement</dt>
                <dd className="text-right font-semibold">{event?.title ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Référence</dt>
                <dd className="font-mono font-semibold">{order.reference}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">Statut</dt>
                <dd>
                  {order.status === 'paid' ? (
                    <StatusBadge tone="success">Déjà réglée</StatusBadge>
                  ) : order.status === 'pending' ? (
                    <StatusBadge tone="warning">En attente</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">{order.status}</StatusBadge>
                  )}
                </dd>
              </div>
              <div className="border-rule flex items-baseline justify-between gap-4 border-t pt-4">
                <dt className="font-semibold">Montant (fictif)</dt>
                <dd className="display text-display-md tabular-nums">
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
        </div>
      </div>
    </PublicShell>
  );
}
