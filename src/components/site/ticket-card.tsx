import { MapPin, Globe, CalendarDays } from 'lucide-react';
import { StatusBadge } from '@/components/ui/badge';
import { formatClock, formatLongDate, zoneCity } from '@/lib/dates';
import { cn } from '@/lib/cn';

/**
 * Billet.
 *
 * Hiérarchie : la catégorie et le statut en haut, le nom du concert en grand,
 * puis date, lieu et titulaire. Le QR code est dans un « talon » séparé par une
 * perforation.
 *
 * Le QR est livré tel que généré : intégral, noir sur blanc, entouré d'une marge
 * calme (la zone de silence dont les lecteurs ont besoin). Aucun filtre,
 * dégradé, coin arrondi ni décor superposé — un QR « habillé » se lit moins bien,
 * et c'est à la porte, dans le noir, que cela se joue.
 *
 * L'image est servie par `/api/tickets/[id]/qr`, qui exige le jeton de la
 * commande : le lien signé n'est jamais transmis à un service tiers.
 */
export interface TicketCardProps {
  ticket: {
    id: string;
    serial: string;
    holderName: string;
    status: string;
    checkedInAt: Date | null;
    ticketTypeName: string;
  };
  event: {
    title: string;
    startsAt: Date;
    timezone: string;
    isOnline: boolean;
    venueName: string | null;
  };
  manageToken: string;
}

export function TicketCard({ ticket, event, manageToken }: TicketCardProps) {
  const used = ticket.checkedInAt !== null;
  const cancelled = ticket.status !== 'valid';
  const place = event.isOnline ? 'En ligne' : (event.venueName ?? 'Lieu à préciser');

  return (
    <article
      className="border-rule bg-paper shadow-panel relative overflow-hidden rounded-ticket border sm:flex"
      aria-label={`Billet ${ticket.serial}, ${ticket.ticketTypeName}`}
    >
      <div className="min-w-0 flex-1 p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="eyebrow text-copper-ink">{ticket.ticketTypeName}</p>
          {cancelled ? (
            <StatusBadge tone="danger">Billet annulé</StatusBadge>
          ) : used ? (
            <StatusBadge tone="info">
              Déjà validé à l&apos;entrée à {formatClock(ticket.checkedInAt!, event.timezone)}
            </StatusBadge>
          ) : (
            <StatusBadge tone="success">Valable</StatusBadge>
          )}
        </div>

        <h3 className="display text-display-md mt-3">{event.title}</h3>

        <dl className="mt-5 space-y-2 text-[0.9375rem]">
          <div className="flex items-start gap-2.5">
            <dt className="sr-only">Date</dt>
            <CalendarDays className="text-ink-soft mt-0.5 size-4 shrink-0" aria-hidden />
            <dd>
              <span className="first-letter:uppercase">
                {formatLongDate(event.startsAt, event.timezone)}
              </span>{' '}
              · {formatClock(event.startsAt, event.timezone)}{' '}
              <span className="text-ink-muted">(heure de {zoneCity(event.timezone)})</span>
            </dd>
          </div>
          <div className="flex items-start gap-2.5">
            <dt className="sr-only">Lieu</dt>
            {event.isOnline ? (
              <Globe className="text-ink-soft mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <MapPin className="text-ink-soft mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            <dd>{place}</dd>
          </div>
        </dl>

        <div className="border-rule mt-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t border-dashed pt-4">
          <div>
            <p className="eyebrow text-ink-muted">Titulaire</p>
            <p className="mt-1 font-semibold">{ticket.holderName}</p>
          </div>
          <div>
            <p className="eyebrow text-ink-muted">N° de billet</p>
            <p className="mt-1 font-mono text-sm font-semibold tracking-wide">{ticket.serial}</p>
          </div>
        </div>
      </div>

      {/* Talon : séparé du corps par une perforation, avec deux encoches. */}
      <div
        className={cn(
          'border-rule relative flex shrink-0 flex-col items-center justify-center gap-3 border-t border-dashed p-5 sm:w-[15.5rem] sm:border-t-0 sm:border-l',
        )}
      >
        <span
          aria-hidden
          className="border-rule bg-canvas absolute -top-2.5 -left-2.5 size-5 rounded-full border"
        />
        <span
          aria-hidden
          className="border-rule bg-canvas absolute -top-2.5 -right-2.5 size-5 rounded-full border sm:top-auto sm:right-auto sm:-bottom-2.5 sm:-left-2.5"
        />

        {cancelled ? (
          <p className="text-danger-ink max-w-[12rem] text-center text-sm font-medium">
            Ce billet n&apos;est plus valable à l&apos;entrée.
          </p>
        ) : used ? (
          <p className="text-ink-soft max-w-[12rem] text-center text-sm">
            Ce billet a déjà été scanné : il n&apos;est plus utilisable.
          </p>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- image générée à la demande, déjà dimensionnée */}
            <img
              src={`/api/tickets/${ticket.id}/qr?t=${encodeURIComponent(manageToken)}`}
              alt={`QR code du billet ${ticket.serial} — à présenter à l'entrée`}
              width={176}
              height={176}
              className="size-44 rounded-[4px] bg-white p-3"
            />
            <p className="text-ink-muted text-center text-sm">À présenter à l&apos;entrée.</p>
          </>
        )}
      </div>
    </article>
  );
}
