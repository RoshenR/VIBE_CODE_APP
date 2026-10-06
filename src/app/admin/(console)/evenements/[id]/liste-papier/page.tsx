import type { Metadata } from 'next';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders, ticketTypes, tickets } from '@/db/schema';
import { formatClock, formatLongDate, zoneCity } from '@/lib/dates';
import { requireEvent } from '@/lib/org';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Liste papier de secours' };

/**
 * Liste papier de secours, à imprimer avant l'ouverture des portes.
 *
 * L'application de scan fonctionne hors ligne — mais un téléphone se casse,
 * tombe en panne de batterie, ou reste dans une poche partie fumer. Le papier,
 * lui, n'a besoin de rien.
 *
 * Elle est triée par NOM DE FAMILLE, et non par numéro de billet : à la porte,
 * on entend un nom, pas une référence. La case à cocher se remplit au stylo ; la
 * colonne « déjà entré » reprend les scans enregistrés au moment de l'impression.
 *
 * Tout le cadre applicatif (navigation, onglets, boutons) est masqué à
 * l'impression par la feuille de style : seul ce document sort sur le papier.
 */
export default async function PaperListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event } = await requireEvent(id, 'participants.exporter');

  const rows = await db
    .select({
      serial: tickets.serial,
      holderName: tickets.holderName,
      checkedInAt: tickets.checkedInAt,
      ticketTypeName: ticketTypes.name,
    })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .where(and(eq(tickets.eventId, id), eq(tickets.status, 'valid'), eq(orders.status, 'paid')))
    .orderBy(asc(tickets.holderName), asc(tickets.serial));

  // Tri sur le nom de famille présumé (dernier mot) : c'est ainsi qu'on cherche
  // quelqu'un dans une liste.
  const sorted = [...rows].sort((a, b) =>
    lastName(a.holderName).localeCompare(lastName(b.holderName), 'fr'),
  );

  const printedAt = new Date();

  return (
    <div>
      <div className="no-print">
        <h2 className="display text-display-md">Liste papier de secours</h2>
        <p className="text-ink-soft measure mt-2">
          À imprimer et à garder à l&apos;entrée. Elle ne remplace pas le scan : elle prend le relais
          quand plus rien ne fonctionne — téléphone cassé, batterie vide, ou appareil parti dans une
          poche. Imprimez avec <kbd className="border-rule-strong bg-paper rounded border px-1.5 py-0.5 font-mono text-sm">Ctrl</kbd>{' '}
          + <kbd className="border-rule-strong bg-paper rounded border px-1.5 py-0.5 font-mono text-sm">P</kbd>{' '}
          (ou <kbd className="border-rule-strong bg-paper rounded border px-1.5 py-0.5 font-mono text-sm">⌘</kbd>{' '}
          + <kbd className="border-rule-strong bg-paper rounded border px-1.5 py-0.5 font-mono text-sm">P</kbd>
          ), <strong>avant</strong> de partir sur place.
        </p>
      </div>

      <section aria-labelledby="papier-titre" className="mt-8 print:mt-0">
        {/* Un <div>, pas un <header> : la feuille d'impression masque toute balise
            <header> (le cadre de l'application), y compris celle-ci. */}
        <div className="border-ink border-b-2 pb-3">
          <h2 id="papier-titre" className="text-xl font-bold">
            {event.title}
          </h2>
          <p className="text-ink-soft">
            <span className="first-letter:uppercase">{formatLongDate(event.startsAt, event.timezone)}</span>{' '}
            · {formatClock(event.startsAt, event.timezone)}
            {event.venueName ? ` · ${event.venueName}` : ''}
          </p>
          <p className="text-ink-muted mt-1 text-sm">
            {sorted.length} personne{sorted.length > 1 ? 's' : ''} attendue{sorted.length > 1 ? 's' : ''} ·
            liste établie le {formatLongDate(printedAt, event.timezone)} à{' '}
            {formatClock(printedAt, event.timezone)} (heure de {zoneCity(event.timezone)})
          </p>
        </div>

        {sorted.length === 0 ? (
          <p className="text-ink-muted py-8 text-center">Aucun billet payé pour le moment.</p>
        ) : (
          <table className="data-table mt-2">
            <caption className="sr-only">Participants attendus, par ordre alphabétique du nom</caption>
            <thead>
              <tr>
                <th scope="col" className="w-12">
                  Entré
                </th>
                <th scope="col">Nom</th>
                <th scope="col">Catégorie</th>
                <th scope="col">Billet</th>
                <th scope="col">Scanné à</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.serial}>
                  {/* Case dessinée, pas un champ : elle doit exister sur le papier. */}
                  <td>
                    <span className="border-ink inline-block size-5 border-2" aria-hidden />
                    <span className="sr-only">Case à cocher</span>
                  </td>
                  <th scope="row">{row.holderName}</th>
                  <td>{row.ticketTypeName}</td>
                  <td className="font-mono text-sm">{row.serial}</td>
                  <td className="text-sm tabular-nums">
                    {row.checkedInAt ? formatClock(row.checkedInAt, event.timezone) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** Dernier mot du nom complet — approximation suffisante pour un tri de porte. */
function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return (parts.at(-1) ?? fullName).toLowerCase();
}
