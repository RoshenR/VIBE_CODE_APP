import Link from 'next/link';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders, ticketTypes, tickets } from '@/db/schema';
import { requireEvent } from '@/lib/org';
import { formatDateTime } from '@/lib/dates';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Liste papier de secours' };

/**
 * Liste papier de secours, à imprimer avant l'ouverture des portes.
 *
 * L'application de scan fonctionne hors ligne — mais un téléphone se casse,
 * tombe en panne de batterie, ou reste dans une poche partie fumer. Le papier,
 * lui, n'a besoin de rien.
 *
 * Elle est triée par **nom de famille**, et non par numéro de billet : à la
 * porte, on entend un nom, pas une référence. Une case à cocher permet de
 * pointer à la main, et la colonne « déjà entré » reprend les scans déjà
 * enregistrés au moment de l'impression.
 */
export default async function PaperListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { event } = await requireEvent(id, 'participants.exporter');

  const rows = await db
    .select({
      serial: tickets.serial,
      holderName: tickets.holderName,
      checkedInAt: tickets.checkedInAt,
      ticketTypeName: ticketTypes.name,
      reference: orders.reference,
    })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .where(and(eq(tickets.eventId, id), eq(tickets.status, 'valid'), eq(orders.status, 'paid')))
    .orderBy(asc(tickets.holderName), asc(tickets.serial));

  // Tri sur le nom de famille présumé : c'est ainsi qu'on cherche quelqu'un dans
  // une liste, et l'ordre alphabétique sur le prénom rend la recherche pénible.
  const sorted = [...rows].sort((a, b) =>
    lastName(a.holderName).localeCompare(lastName(b.holderName), 'fr'),
  );

  return (
    <div>
      {/* Masqué à l'impression : ne gaspille pas la première page. */}
      <div className="print:hidden">
        <Link
          href={`/admin/evenements/${id}`}
          className="text-ink-500 hover:text-ink-800 text-sm"
        >
          ← {event.title}
        </Link>
        <h1 className="text-ink-900 mt-1 text-xl font-semibold tracking-tight">
          Liste papier de secours
        </h1>
        <p className="text-ink-500 mt-1 max-w-prose text-sm">
          À imprimer et à garder à l&apos;entrée. Elle ne remplace pas le scan — elle
          prend le relais quand plus rien ne fonctionne : téléphone cassé, batterie
          vide, ou personne qui part avec l&apos;appareil dans la poche.
        </p>
        <p className="text-ink-500 mt-4 text-sm">
          Imprimez avec le raccourci de votre navigateur (Ctrl/Cmd + P), et faites-le{' '}
          <strong>avant</strong> de partir sur place.
        </p>
      </div>

      <div className="mt-6 print:mt-0">
        <header className="border-ink-300 border-b pb-3">
          <h2 className="text-lg font-semibold">{event.title}</h2>
          <p className="text-ink-600 text-sm">
            {formatDateTime(event.startsAt, event.timezone)}
            {event.venueName ? ` · ${event.venueName}` : ''}
          </p>
          <p className="text-ink-500 mt-1 text-sm">
            {sorted.length} personne{sorted.length > 1 ? 's' : ''} attendue
            {sorted.length > 1 ? 's' : ''} · liste établie le{' '}
            {formatDateTime(new Date(), event.timezone)}
          </p>
        </header>

        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-ink-300 border-b text-left">
              <th className="w-10 py-2">✓</th>
              <th className="py-2">Nom</th>
              <th className="py-2">Catégorie</th>
              <th className="py-2">Billet</th>
              <th className="py-2">Déjà entré</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.serial} className="border-ink-200 border-b">
                {/* Case à cocher dessinée, pas un champ : elle doit exister sur
                    le papier, pas dans le navigateur. */}
                <td className="py-2">
                  <span className="border-ink-500 inline-block h-4 w-4 border" />
                </td>
                <td className="py-2 font-medium">{row.holderName}</td>
                <td className="text-ink-600 py-2">{row.ticketTypeName}</td>
                <td className="text-ink-500 py-2 font-mono text-xs">{row.serial}</td>
                <td className="py-2 text-xs">
                  {row.checkedInAt
                    ? new Intl.DateTimeFormat('fr-FR', {
                        timeZone: event.timezone,
                        timeStyle: 'short',
                      }).format(row.checkedInAt)
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {sorted.length === 0 && (
          <p className="text-ink-500 py-8 text-center text-sm">
            Aucun billet payé pour le moment.
          </p>
        )}
      </div>
    </div>
  );
}

/** Dernier mot du nom complet — approximation suffisante pour un tri de porte. */
function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return (parts.at(-1) ?? fullName).toLowerCase();
}
