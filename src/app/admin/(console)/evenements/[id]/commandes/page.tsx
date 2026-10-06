import type { Metadata } from 'next';
import Link from 'next/link';
import { and, count, desc, eq, ilike, or } from 'drizzle-orm';
import { Receipt, Search, SearchX } from 'lucide-react';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { OrderStatusBadge, PAYMENT_METHOD_LABEL } from '@/components/admin/order-status';
import { Button } from '@/components/ui/button';
import { EmptyState, InlineAlert } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { formatShort } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { requireEvent } from '@/lib/org';
import { can } from '@/lib/permissions';
import { OrderRowActions } from './row-actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Commandes' };

const STATUSES = ['pending', 'paid', 'expired', 'cancelled', 'refunded'] as const;
type OrderStatus = (typeof STATUSES)[number];

const FILTER_LABEL: Record<OrderStatus, string> = {
  pending: 'À payer',
  paid: 'Payées',
  expired: 'Expirées',
  cancelled: 'Annulées',
  refunded: 'Remboursements',
};

const LIMIT = 300;

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; statut?: string }>;
}) {
  const { id } = await params;
  const { q = '', statut } = await searchParams;
  const { user, event } = await requireEvent(id);
  const canCancel = can(user, 'commande.annuler');

  const status = STATUSES.find((s) => s === statut);
  const term = q.trim().slice(0, 80);

  // Les caractères génériques de LIKE sont neutralisés : une recherche « 100% »
  // ou « a_b » doit chercher ces caractères, pas tout renvoyer.
  const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;

  const conditions = [
    eq(orders.eventId, id),
    status ? eq(orders.status, status) : undefined,
    term
      ? or(
          ilike(orders.reference, pattern),
          ilike(orders.customerName, pattern),
          ilike(orders.customerEmail, pattern),
        )
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const [rows, countsRows] = await Promise.all([
    db
      .select()
      .from(orders)
      .where(and(...conditions))
      .orderBy(desc(orders.createdAt))
      .limit(LIMIT + 1),
    db
      .select({ status: orders.status, n: count() })
      .from(orders)
      .where(eq(orders.eventId, id))
      .groupBy(orders.status),
  ]);

  const truncated = rows.length > LIMIT;
  const visible = rows.slice(0, LIMIT);
  const counts = new Map(countsRows.map((c) => [c.status, Number(c.n)]));
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  const href = (next: { statut?: OrderStatus }) => {
    const params = new URLSearchParams();
    if (term) params.set('q', term);
    if (next.statut) params.set('statut', next.statut);
    const query = params.toString();
    return `/admin/evenements/${id}/commandes${query ? `?${query}` : ''}`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="display text-display-md">Commandes</h2>
          <p className="text-ink-muted mt-1">
            {total} commande{total > 1 ? 's' : ''} au total
            {(term || status) && ` · ${visible.length}${truncated ? '+' : ''} correspondante${visible.length > 1 ? 's' : ''}`}
          </p>
        </div>

        <form role="search" className="flex w-full gap-2 sm:w-auto" action={`/admin/evenements/${id}/commandes`}>
          {status && <input type="hidden" name="statut" value={status} />}
          <div className="relative min-w-0 flex-1 sm:w-72">
            <label htmlFor="recherche" className="sr-only">
              Rechercher une commande
            </label>
            <Search
              className="text-ink-muted pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <input
              id="recherche"
              name="q"
              type="search"
              defaultValue={term}
              placeholder="Référence, nom ou e-mail"
              className="border-rule-strong bg-paper hover:border-ink focus:border-ink h-12 w-full rounded-control border pr-3 pl-10 text-base outline-none"
            />
          </div>
          <Button type="submit" variant="solid">
            Rechercher
          </Button>
        </form>
      </div>

      <nav aria-label="Filtrer par statut" className="mt-6 flex flex-wrap gap-2">
        <FilterChip href={href({})} active={!status}>
          Toutes ({total})
        </FilterChip>
        {STATUSES.map((s) => (
          <FilterChip key={s} href={href({ statut: s })} active={status === s}>
            {FILTER_LABEL[s]} ({counts.get(s) ?? 0})
          </FilterChip>
        ))}
      </nav>

      {(counts.get('refunded') ?? 0) > 0 && (
        <InlineAlert tone="info" title="« Remboursement enregistré » ne veut pas dire « remboursé »" className="mt-6">
          L&apos;annulation d&apos;une commande payée est enregistrée ici, mais aucun virement n&apos;est
          exécuté : le remboursement bancaire reste à faire par l&apos;équipe.
        </InlineAlert>
      )}

      {total === 0 ? (
        <div className="mt-8">
          <EmptyState icon={Receipt} title="Aucune commande pour le moment">
            Les réservations apparaîtront ici dès qu&apos;un visiteur validera ses places.
          </EmptyState>
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={SearchX}
            title="Aucune commande ne correspond"
            action={
              <Link
                href={`/admin/evenements/${id}/commandes`}
                className="border-ink text-ink hover:bg-ink hover:text-canvas inline-flex h-12 items-center rounded-control border px-5 font-semibold transition-colors"
              >
                Effacer la recherche
              </Link>
            }
          >
            Vérifiez l&apos;orthographe, ou cherchez une partie de l&apos;adresse e-mail.
          </EmptyState>
        </div>
      ) : (
        <>
          {truncated && (
            <InlineAlert tone="warning" className="mt-6">
              Seules les {LIMIT} commandes les plus récentes sont affichées. Affinez la recherche
              pour retrouver une commande plus ancienne.
            </InlineAlert>
          )}

          {/* Ordinateur : tableau. */}
          <div className="border-rule bg-paper shadow-panel mt-6 hidden overflow-hidden rounded-panel border md:block">
            <table className="data-table">
              <caption className="sr-only">Commandes de l&apos;événement</caption>
              <thead>
                <tr>
                  <th scope="col">Commande</th>
                  <th scope="col">Client</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Paiement</th>
                  <th scope="col" className="num">
                    Montant
                  </th>
                  {canCancel && (
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {visible.map((order) => (
                  <tr key={order.id}>
                    <th scope="row">
                      <span className="font-mono text-sm">{order.reference}</span>
                      <span className="text-ink-muted mt-0.5 block text-xs font-normal">
                        {formatShort(order.createdAt, event.timezone)}
                      </span>
                    </th>
                    <td className="max-w-[16rem]">
                      <span className="block font-medium">{order.customerName}</span>
                      <span className="text-ink-muted block truncate text-sm">
                        {order.customerEmail}
                      </span>
                    </td>
                    <td>
                      <OrderStatusBadge status={order.status} />
                      {order.status === 'pending' && order.holdExpiresAt && (
                        <span className="text-ink-muted mt-1 block text-xs">
                          jusqu&apos;au {formatShort(order.holdExpiresAt, event.timezone)}
                        </span>
                      )}
                    </td>
                    <td>{PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod}</td>
                    <td className="num font-semibold">
                      {formatCents(order.totalCents, order.currency)}
                    </td>
                    {canCancel && (
                      <td className="text-right">
                        {(order.status === 'paid' || order.status === 'pending') && (
                          <OrderRowActions
                            orderId={order.id}
                            eventId={id}
                            reference={order.reference}
                            customerName={order.customerName}
                            totalCents={order.totalCents}
                            paid={order.status === 'paid'}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile : une carte par commande. */}
          <ul className="mt-6 space-y-3 md:hidden">
            {visible.map((order) => (
              <li key={order.id} className="border-rule bg-paper shadow-panel rounded-panel border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold">{order.reference}</p>
                    <p className="text-ink-muted text-xs">{formatShort(order.createdAt, event.timezone)}</p>
                  </div>
                  <p className="display text-display-sm tabular-nums">
                    {formatCents(order.totalCents, order.currency)}
                  </p>
                </div>
                <p className="mt-3 font-medium">{order.customerName}</p>
                <p className="text-ink-muted truncate text-sm">{order.customerEmail}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <OrderStatusBadge status={order.status} />
                  <span className="text-ink-soft text-sm">
                    {PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod}
                  </span>
                </div>
                {order.status === 'pending' && order.holdExpiresAt && (
                  <p className="text-ink-muted mt-2 text-xs">
                    Échéance : {formatShort(order.holdExpiresAt, event.timezone)}
                  </p>
                )}
                {canCancel && (order.status === 'paid' || order.status === 'pending') && (
                  <div className="mt-4">
                    <OrderRowActions
                      orderId={order.id}
                      eventId={id}
                      reference={order.reference}
                      customerName={order.customerName}
                      totalCents={order.totalCents}
                      paid={order.status === 'paid'}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function FilterChip({
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
      aria-current={active ? 'true' : undefined}
      className={cn(
        'inline-flex h-11 items-center rounded-control border px-4 text-sm font-semibold transition-colors duration-150',
        active
          ? 'border-ink bg-ink text-canvas'
          : 'border-rule-strong text-ink hover:border-ink hover:bg-sunken',
      )}
    >
      {children}
    </Link>
  );
}
