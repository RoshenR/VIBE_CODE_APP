'use client';

import { useState } from 'react';

interface Log {
  label: string;
  detail: string;
  tone: 'ok' | 'info' | 'warn';
}

/**
 * Panneau de simulation.
 *
 * Le bouton « renvoyer la même notification » reproduit exactement l'incident
 * décrit dans le brief. Le journal affiché montre que la seconde notification est
 * reconnue comme un doublon et qu'aucun billet supplémentaire n'est créé.
 */
export function SimulatorPanel({
  orderId,
  providerRef,
  manageToken,
  alreadyPaid,
}: {
  orderId: string;
  providerRef: string;
  manageToken: string;
  alreadyPaid: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);

  async function trigger(options: {
    outcome: 'succeeded' | 'failed';
    replay?: boolean;
  }): Promise<void> {
    if (busy) return;
    setBusy(true);

    try {
      const response = await fetch('/api/paiement/simulateur', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderId,
          providerRef,
          outcome: options.outcome,
          replayEventId: options.replay ? lastEventId : undefined,
        }),
      });

      const result = await response.json();
      setLastEventId(result.eventId);

      const status = result.webhookResult?.status as string | undefined;

      setLogs((prev) => [
        {
          label: options.replay
            ? 'Notification renvoyée (même identifiant)'
            : `Notification « paiement ${options.outcome === 'failed' ? 'refusé' : 'accepté'} »`,
          detail:
            status === 'duplicate'
              ? 'Reconnue comme doublon — ignorée, aucun billet supplémentaire.'
              : status === 'processed'
                ? 'Traitée — billets émis et e-mail mis en file.'
                : `Réponse : ${status ?? response.status}`,
          tone: status === 'duplicate' ? 'warn' : status === 'processed' ? 'ok' : 'info',
        },
        ...prev,
      ]);
    } catch {
      setLogs((prev) => [
        { label: 'Échec réseau', detail: 'La notification n’a pas pu être envoyée.', tone: 'info' },
        ...prev,
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => trigger({ outcome: 'succeeded' })}
        disabled={busy}
        className="bg-ink-900 hover:bg-ink-800 w-full rounded-xl px-5 py-3.5 font-semibold text-white disabled:opacity-60"
      >
        Payer
      </button>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => trigger({ outcome: 'succeeded', replay: true })}
          disabled={busy || !lastEventId}
          className="border-ink-300 text-ink-700 rounded-xl border px-3 py-2.5 text-sm font-medium disabled:opacity-40"
        >
          Renvoyer la même notification
        </button>
        <button
          type="button"
          onClick={() => trigger({ outcome: 'failed' })}
          disabled={busy}
          className="border-ink-300 text-ink-700 rounded-xl border px-3 py-2.5 text-sm font-medium disabled:opacity-40"
        >
          Simuler un refus
        </button>
      </div>

      <p className="text-ink-500 mt-2 text-xs">
        « Renvoyer la même notification » reproduit le cas du prestataire qui envoie
        deux fois le même événement.
      </p>

      {logs.length > 0 && (
        <ul className="mt-5 space-y-2" aria-live="polite">
          {logs.map((log, i) => (
            <li
              key={i}
              className={`rounded-lg border px-3 py-2 text-sm ${
                log.tone === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : log.tone === 'warn'
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-ink-200 bg-ink-100 text-ink-700'
              }`}
            >
              <span className="font-medium">{log.label}</span>
              <span className="mt-0.5 block text-xs opacity-90">{log.detail}</span>
            </li>
          ))}
        </ul>
      )}

      <a
        href={`/commande/${manageToken}`}
        className="border-ink-300 mt-5 block rounded-xl border px-5 py-3 text-center text-sm font-medium"
      >
        {alreadyPaid ? 'Voir mes billets' : 'Revenir à ma commande'}
      </a>
    </div>
  );
}
