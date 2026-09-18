'use client';

import { useEffect, useState } from 'react';

interface TicketRow {
  id: string;
  serial: string;
  holderName: string;
  status: string;
  checkedInAt: Date | null;
  ticketTypeName: string;
}

/**
 * Affiche les QR codes des billets.
 *
 * Les images sont servies par `/api/tickets/[id]/qr` et mises en cache par le
 * navigateur : une fois la page ouverte, les billets restent visibles même si le
 * réseau lâche devant la salle.
 */
export function TicketList({
  tickets,
  manageToken,
}: {
  tickets: TicketRow[];
  manageToken: string;
}) {
  return (
    <ul className="mt-4 space-y-3">
      {tickets.map((ticket) => (
        <li
          key={ticket.id}
          className="border-ink-200 rounded-2xl border bg-white p-5 text-center"
        >
          <p className="text-ink-500 text-xs font-medium tracking-wide uppercase">
            {ticket.ticketTypeName}
          </p>
          <p className="text-ink-900 mt-1 font-medium">{ticket.holderName}</p>

          {ticket.checkedInAt ? (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Déjà validé à l&apos;entrée
              <ScannedAt iso={new Date(ticket.checkedInAt).toISOString()} />
            </p>
          ) : (
            <img
              src={`/api/tickets/${ticket.id}/qr?t=${encodeURIComponent(manageToken)}`}
              alt={`QR code du billet ${ticket.serial}`}
              width={200}
              height={200}
              className="mx-auto mt-3 rounded-lg"
            />
          )}

          <p className="text-ink-500 mt-2 font-mono text-xs">{ticket.serial}</p>
        </li>
      ))}
    </ul>
  );
}

/** Rendu côté client pour afficher l'heure dans le fuseau du visiteur. */
function ScannedAt({ iso }: { iso: string }) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    setLabel(
      new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(iso),
      ),
    );
  }, [iso]);

  return label ? <span className="block text-xs opacity-80">le {label}</span> : null;
}
