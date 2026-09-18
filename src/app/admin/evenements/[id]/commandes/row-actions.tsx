'use client';

import { useState, useTransition } from 'react';
import { cancelOrderAction } from '@/app/admin/actions';

/**
 * Annulation d'une commande par l'équipe.
 *
 * Confirmation explicite : le geste invalide des billets déjà envoyés et remet
 * les places en vente immédiatement.
 */
export function OrderRowActions({ orderId, eventId }: { orderId: string; eventId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-ink-500 hover:text-rose-700 mt-1 text-xs underline underline-offset-2"
      >
        Annuler
      </button>
    );
  }

  return (
    <div className="mt-2 flex items-center justify-end gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await cancelOrderAction(orderId, eventId);
            setConfirming(false);
          })
        }
        className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
      >
        {pending ? '…' : 'Confirmer'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="border-ink-300 rounded-lg border px-3 py-1.5 text-xs"
      >
        Non
      </button>
    </div>
  );
}
