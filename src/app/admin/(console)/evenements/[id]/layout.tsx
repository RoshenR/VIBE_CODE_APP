import Link from 'next/link';
import { ChevronRight, Download, Printer, ScanLine } from 'lucide-react';
import { EventStatusBadge } from '@/components/admin/event-status';
import { EventTabs, type Tab } from '@/components/admin/event-tabs';
import { ButtonLink } from '@/components/ui/button';
import { formatClock, formatLongDate, zoneCity, zoneLabel } from '@/lib/dates';
import { requireEvent } from '@/lib/org';
import { can } from '@/lib/permissions';

/**
 * Cadre commun à toutes les pages d'un événement : le contexte (quel événement,
 * quel statut, quand) et la navigation entre ses sections.
 *
 * Il rend le contexte explicite en permanence — on ne se demande jamais « sur
 * quelle soirée suis-je en train d'agir ? » — et regroupe les actions qui
 * concernent la soirée entière, plutôt que de les enfouir dans une grille de
 * cartes.
 */
export default async function EventLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user, event } = await requireEvent(id);

  const base = `/admin/evenements/${id}`;
  const tabs: Tab[] = [
    { href: base, label: "Vue d'ensemble", exact: true },
    { href: `${base}/commandes`, label: 'Commandes' },
    { href: `${base}/liste-attente`, label: "Liste d'attente" },
    ...(can(user, 'evenement.modifier') ? [{ href: `${base}/reglages`, label: 'Réglages' }] : []),
    { href: `${base}/journal`, label: 'Journal' },
  ];

  return (
    <div>
      <div className="print:hidden">
        <nav aria-label="Fil d'Ariane" className="text-ink-muted flex items-center gap-1.5 text-sm">
          <Link href="/admin" className="hover:text-ink inline-flex min-h-11 items-center underline-offset-4 hover:underline">
            Événements
          </Link>
          <ChevronRight className="size-3.5" aria-hidden />
          <span className="text-ink-soft truncate font-medium" aria-current="page">
            {event.title}
          </span>
        </nav>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            <h1 className="display text-display-lg">{event.title}</h1>
            <p className="text-ink-soft mt-2 text-[1.0625rem]">
              <span className="first-letter:uppercase">
                {formatLongDate(event.startsAt, event.timezone)}
              </span>{' '}
              · {formatClock(event.startsAt, event.timezone)}{' '}
              <span className="text-ink-muted">
                (heure de {zoneCity(event.timezone)}, {zoneLabel(event.startsAt, event.timezone)})
              </span>
            </p>
            <div className="mt-3">
              <EventStatusBadge status={event.status} />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <ButtonLink href={`/admin/controle/${id}`} prefetch={false}>
              <ScanLine className="size-5" aria-hidden />
              Ouvrir le contrôle
            </ButtonLink>
            {can(user, 'participants.exporter') && (
              <>
                <ButtonLink href={`${base}/liste-papier`} variant="secondary">
                  <Printer className="size-4" aria-hidden />
                  Liste papier
                </ButtonLink>
                {/* Téléchargement : un lien simple, pas de navigation applicative. */}
                <a
                  href={`${base}/export`}
                  download
                  className="border-ink text-ink hover:bg-ink hover:text-canvas inline-flex h-12 items-center justify-center gap-2 rounded-control border px-5 text-[0.95rem] font-semibold transition-colors duration-200"
                >
                  <Download className="size-4" aria-hidden />
                  Exporter (CSV)
                </a>
              </>
            )}
          </div>
        </div>

        <EventTabs tabs={tabs} />
      </div>

      <div className="mt-8 print:mt-0">{children}</div>
    </div>
  );
}
