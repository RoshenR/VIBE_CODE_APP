'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Repeat2 } from 'lucide-react';
import { Button, buttonClasses } from '@/components/ui/button';
import { InlineAlert } from '@/components/ui/states';

interface Log {
  label: string;
  detail: string;
  tone: 'success' | 'warning' | 'info' | 'danger';
}

/**
 * Panneau de simulation.
 *
 * « Renvoyer la même notification » reproduit exactement l'incident décrit dans
 * le brief. Le journal affiché montre que la seconde notification est reconnue
 * comme un doublon et qu'aucun billet supplémentaire n'est créé.
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
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [paid, setPaid] = useState(alreadyPaid);
  const [logs, setLogs] = useState<Log[]>([]);
  const inFlight = useRef(false);

  async function trigger(options: { outcome: 'succeeded' | 'failed'; replay?: boolean }) {
    if (inFlight.current) return;
    inFlight.current = true;
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
      if (!response.ok) throw new Error(result.error ?? 'refus');
      setLastEventId(result.eventId);

      const status = result.webhookResult?.status as string | undefined;
      if (status === 'processed' && options.outcome === 'succeeded') {
        setPaid(true);
        // Le statut affiché plus haut est rendu côté serveur : sans ce rafraîchissement,
        // il resterait sur « En attente » alors que la commande est réglée.
        router.refresh();
      }

      setLogs((prev) => [
        {
          label: options.replay
            ? 'Notification renvoyée (même identifiant)'
            : `Notification « paiement ${options.outcome === 'failed' ? 'refusé' : 'accepté'} » envoyée`,
          detail:
            status === 'duplicate'
              ? 'Reconnue comme doublon et ignorée : aucun billet supplémentaire.'
              : status === 'processed'
                ? options.outcome === 'failed'
                  ? 'Traitée : le refus est enregistré, la commande reste à régler.'
                  : 'Traitée : billets émis, e-mail mis en file.'
                : `Réponse du serveur : ${status ?? response.status}.`,
          tone:
            status === 'duplicate'
              ? 'warning'
              : status === 'processed'
                ? options.outcome === 'failed'
                  ? 'info'
                  : 'success'
                : 'info',
        },
        ...prev,
      ]);
    } catch {
      setLogs((prev) => [
        {
          label: 'La simulation a échoué',
          detail: 'La notification n’a pas pu être envoyée. Rien n’a été modifié.',
          tone: 'danger',
        },
        ...prev,
      ]);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-8">
      <Button
        size="lg"
        block
        loading={busy}
        disabled={paid}
        onClick={() => trigger({ outcome: 'succeeded' })}
      >
        {paid ? 'Paiement simulé effectué' : 'Payer (simulation)'}
      </Button>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Button
          variant="secondary"
          disabled={busy || !lastEventId}
          onClick={() => trigger({ outcome: 'succeeded', replay: true })}
        >
          <Repeat2 className="size-4" aria-hidden />
          Renvoyer la même notification
        </Button>
        <Button variant="secondary" disabled={busy || paid} onClick={() => trigger({ outcome: 'failed' })}>
          Simuler un refus
        </Button>
      </div>

      <p className="text-ink-muted mt-3 text-sm">
        « Renvoyer la même notification » reproduit le cas d&apos;un prestataire qui envoie deux fois
        le même événement : un seul jeu de billets doit être émis.
      </p>

      {logs.length > 0 && (
        <ul className="mt-6 space-y-3" aria-live="polite" aria-label="Journal de la simulation">
          {logs.map((log, i) => (
            <li key={i}>
              <InlineAlert tone={log.tone} title={log.label}>
                {log.detail}
              </InlineAlert>
            </li>
          ))}
        </ul>
      )}

      <Link
        href={`/commande/${manageToken}`}
        className={buttonClasses({ variant: paid ? 'primary' : 'secondary', block: true, className: 'mt-6' })}
      >
        {paid ? 'Voir mes billets' : 'Retour à ma commande'}
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}
