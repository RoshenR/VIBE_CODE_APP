import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { ArrowRight, CalendarDays, CalendarPlus, ScanLine } from 'lucide-react';
import { db } from '@/db';
import { events } from '@/db/schema';
import { EventStatusBadge } from '@/components/admin/event-status';
import { FillMeter } from '@/components/admin/fill-meter';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import { Stat } from '@/components/ui/stat';
import { formatClock, formatLongDate } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { requireUser } from '@/lib/org';
import { can } from '@/lib/permissions';
import { getOrganizationOverview } from '@/server/reporting';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Événements' };

export default async function AdminHome() {
  const user = await requireUser();

  // Le poste d'entrée ne voit ni chiffres ni encaissements : seulement les
  // événements qu'il peut contrôler.
  if (!can(user, 'chiffres.lire')) return <ScannerHome organizationId={user.organizationId} organizationName={user.organizationName} />;

  const all = await getOrganizationOverview(user.organizationId);
  const now = new Date();

  const upcoming = all
    .filter((e) => e.startsAt >= now)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const past = all.filter((e) => e.startsAt < now);

  const revenue = all.reduce((sum, e) => sum + e.revenueCents, 0);
  const sold = all.reduce((sum, e) => sum + e.sold, 0);
  const held = all.reduce((sum, e) => sum + Math.max(0, e.reserved - e.sold), 0);
  const onSale = all.filter((e) => e.status === 'published' && e.startsAt >= now).length;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-copper-ink">{user.organizationName}</p>
          <h1 className="display text-display-lg mt-1">Événements</h1>
        </div>
        {can(user, 'evenement.creer') && (
          <ButtonLink href="/admin/evenements/nouveau">
            <CalendarPlus className="size-5" aria-hidden />
            Nouvel événement
          </ButtonLink>
        )}
      </div>

      {/* Totaux : tous les événements du collectif, de tous les temps. */}
      <section aria-labelledby="totaux-titre" className="mt-8">
        <h2 id="totaux-titre" className="sr-only">
          Totaux du collectif
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Encaissé" value={formatCents(revenue)} detail="commandes payées, tous événements" emphasis />
          <Stat label="Billets vendus" value={String(sold)} unit="billets" detail="commandes payées" />
          <Stat
            label="Réservations en attente"
            value={String(held)}
            unit="places"
            detail="retenues, pas encore payées"
          />
          <Stat label="En vente" value={String(onSale)} unit={onSale > 1 ? 'événements' : 'événement'} detail="à venir et publiés" />
        </div>
      </section>

      {all.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={CalendarDays}
            title="Aucun événement pour le moment"
            action={
              can(user, 'evenement.creer') ? (
                <ButtonLink href="/admin/evenements/nouveau">Créer le premier événement</ButtonLink>
              ) : undefined
            }
          >
            Un événement est créé en brouillon : vous ajoutez ses catégories de places, puis vous
            ouvrez la vente quand tout est prêt.
          </EmptyState>
        </div>
      ) : (
        <>
          <EventTable title="À venir" rows={upcoming} />
          {past.length > 0 && <EventTable title="Passés" rows={past} muted />}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

type Row = Awaited<ReturnType<typeof getOrganizationOverview>>[number];

function EventTable({ title, rows, muted = false }: { title: string; rows: Row[]; muted?: boolean }) {
  if (rows.length === 0) {
    return (
      <section className="mt-12">
        <h2 className="display text-display-sm">{title}</h2>
        <p className="text-ink-muted mt-3">Aucun événement.</p>
      </section>
    );
  }

  return (
    <section className="mt-12" aria-labelledby={`t-${title}`}>
      <h2 id={`t-${title}`} className="display text-display-sm">
        {title}{' '}
        <span className="text-ink-muted font-sans text-base font-medium normal-case tracking-normal">
          ({rows.length})
        </span>
      </h2>

      {/* Ordinateur : un vrai tableau. */}
      <div className="border-rule bg-paper shadow-panel mt-4 hidden overflow-hidden rounded-panel border md:block">
        <table className="data-table">
          <caption className="sr-only">{title} : événements du collectif</caption>
          <thead>
            <tr>
              <th scope="col">Événement</th>
              <th scope="col">Remplissage</th>
              <th scope="col" className="num">
                Encaissé
              </th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((event) => (
              <tr key={event.id} className={muted ? 'text-ink-soft' : undefined}>
                <td className="max-w-[26rem]">
                  <Link
                    href={`/admin/evenements/${event.id}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {event.title}
                  </Link>
                  <p className="text-ink-muted mt-0.5 text-sm">
                    <span className="first-letter:uppercase">
                      {formatLongDate(event.startsAt, event.timezone)}
                    </span>{' '}
                    · {formatClock(event.startsAt, event.timezone)}
                  </p>
                  <div className="mt-2">
                    <EventStatusBadge status={event.status} />
                  </div>
                </td>
                <td className="w-[16rem]">
                  <FillMeter
                    label={`Remplissage de ${event.title}`}
                    sold={event.sold}
                    held={Math.max(0, event.reserved - event.sold)}
                    capacity={event.capacity}
                  />
                </td>
                <td className="num font-semibold">{formatCents(event.revenueCents)}</td>
                <td className="text-right">
                  <Link
                    href={`/admin/evenements/${event.id}`}
                    className="text-ink-soft hover:text-ink inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold"
                    aria-label={`Ouvrir ${event.title}`}
                  >
                    Ouvrir
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile : une carte par événement, mêmes informations. */}
      <ul className="mt-4 space-y-3 md:hidden">
        {rows.map((event) => (
          <li key={event.id}>
            <Link
              href={`/admin/evenements/${event.id}`}
              className="border-rule bg-paper shadow-panel block rounded-panel border p-4"
            >
              <p className="font-semibold">{event.title}</p>
              <p className="text-ink-muted mt-0.5 text-sm">
                <span className="first-letter:uppercase">
                  {formatLongDate(event.startsAt, event.timezone)}
                </span>{' '}
                · {formatClock(event.startsAt, event.timezone)}
              </p>
              <div className="mt-2">
                <EventStatusBadge status={event.status} />
              </div>
              <FillMeter
                className="mt-4"
                label={`Remplissage de ${event.title}`}
                sold={event.sold}
                held={Math.max(0, event.reserved - event.sold)}
                capacity={event.capacity}
              />
              <p className="mt-3 flex items-baseline justify-between text-sm">
                <span className="text-ink-soft">Encaissé</span>
                <span className="display text-display-sm tabular-nums">
                  {formatCents(event.revenueCents)}
                </span>
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Accueil du poste d'entrée                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Ce que voit le rôle « poste d'entrée » : les événements à contrôler, et rien
 * d'autre. Pas un chiffre de vente, pas un montant.
 */
async function ScannerHome({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      startsAt: events.startsAt,
      timezone: events.timezone,
      venueName: events.venueName,
      isOnline: events.isOnline,
    })
    .from(events)
    .where(and(eq(events.organizationId, organizationId), eq(events.status, 'published')))
    .orderBy(desc(events.startsAt))
    .limit(30);

  const now = new Date();
  const dayMs = 86_400_000;
  // Les soirées d'hier et d'aujourd'hui d'abord : c'est ce qu'on contrôle.
  const relevant = rows
    .filter((e) => e.startsAt.getTime() > now.getTime() - 2 * dayMs)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  return (
    <div>
      <p className="eyebrow text-copper-ink">{organizationName}</p>
      <h1 className="display text-display-lg mt-1">Contrôle à l&apos;entrée</h1>
      <p className="text-ink-soft measure mt-3">
        Choisissez la soirée à contrôler. Chargez la liste des billets tant que vous avez du réseau :
        le scan fonctionne ensuite sans connexion.
      </p>

      {relevant.length === 0 ? (
        <div className="mt-8">
          <EmptyState icon={ScanLine} title="Aucune soirée à contrôler">
            Les événements publiés à venir apparaîtront ici.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {relevant.map((event) => (
            <li
              key={event.id}
              className="border-rule bg-paper shadow-panel flex flex-wrap items-center justify-between gap-4 rounded-panel border p-5"
            >
              <div className="min-w-0">
                <p className="display text-display-sm">{event.title}</p>
                <p className="text-ink-soft mt-1 text-[0.9375rem]">
                  <span className="first-letter:uppercase">
                    {formatLongDate(event.startsAt, event.timezone)}
                  </span>{' '}
                  · {formatClock(event.startsAt, event.timezone)} ·{' '}
                  {event.isOnline ? 'En ligne' : (event.venueName ?? 'Lieu à préciser')}
                </p>
              </div>
              <ButtonLink href={`/admin/controle/${event.id}`} size="lg" className="w-full sm:w-auto">
                <ScanLine className="size-5" aria-hidden />
                Ouvrir le contrôle
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
