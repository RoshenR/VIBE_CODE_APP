import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { requireEvent } from '@/lib/org';
import { formatCents } from '@/lib/money';
import { formatShort } from '@/lib/dates';
import { Badge } from '@/app/_components/chrome';
import { OrderRowActions } from './row-actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' }> = {
  pending: { label: 'À payer', tone: 'warn' },
  paid: { label: 'Payée', tone: 'ok' },
  expired: { label: 'Expirée', tone: 'neutral' },
  cancelled: { label: 'Annulée', tone: 'danger' },
  refunded: { label: 'Remboursée', tone: 'danger' },
};

export default async function OrdersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event } = await requireEvent(id);

  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.eventId, id))
    .orderBy(desc(orders.createdAt))
    .limit(300);

  return (
    <div>
      <Link
        href={`/admin/evenements/${id}`}
        className="text-ink-500 hover:text-ink-800 text-sm"
      >
        ← {event.title}
      </Link>
      <h1 className="text-ink-900 mt-1 text-xl font-semibold tracking-tight">Commandes</h1>
      <p className="text-ink-500 mt-1 text-sm">
        {rows.length} commande{rows.length > 1 ? 's' : ''} · les 300 plus récentes
      </p>

      {rows.length === 0 ? (
        <p className="border-ink-200 mt-6 rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-ink-500">
          Aucune commande pour le moment.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {rows.map((order) => {
            const status = STATUS[order.status] ?? {
              label: order.status,
              tone: 'neutral' as const,
            };

            return (
              <li
                key={order.id}
                className="border-ink-200 rounded-xl border bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium">
                        {order.reference}
                      </span>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {order.paymentMethod === 'transfer' && (
                        <span className="text-ink-400 text-xs">virement</span>
                      )}
                    </div>
                    <p className="text-ink-700 mt-1 text-sm">{order.customerName}</p>
                    <p className="text-ink-500 truncate text-sm">{order.customerEmail}</p>
                    <p className="text-ink-400 mt-1 text-xs">
                      {formatShort(order.createdAt, event.timezone)}
                      {order.status === 'pending' && order.holdExpiresAt && (
                        <>
                          {' · expire le '}
                          {formatShort(order.holdExpiresAt, event.timezone)}
                        </>
                      )}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-semibold tabular-nums">
                      {formatCents(order.totalCents, order.currency)}
                    </p>
                    {(order.status === 'paid' || order.status === 'pending') && (
                      <OrderRowActions orderId={order.id} eventId={id} />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
