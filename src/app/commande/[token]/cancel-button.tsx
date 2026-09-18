'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Annulation autonome.
 *
 * Confirmation en deux temps plutôt qu'un `confirm()` natif : le geste est
 * irréversible et les places repartent immédiatement à la vente.
 */
export function CancelButton({ token, wasPaid }: { token: string; wasPaid: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/commande/${token}/annuler`, { method: 'POST' });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? 'Annulation impossible.');
        return;
      }
      router.refresh();
    } catch {
      setError('Connexion interrompue. Réessayez.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="border-ink-300 text-ink-700 hover:bg-ink-100 rounded-xl border px-5 py-3 text-sm font-medium transition-colors"
        >
          Annuler ma commande
        </button>
        {error && (
          <p role="alert" className="mt-2 text-sm text-rose-700">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
      <p className="text-sm text-rose-900">
        Confirmer l&apos;annulation&nbsp;? Vos billets seront invalidés et vos places
        remises en vente.
        {wasPaid && ' Le remboursement sera traité par l’équipe.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="rounded-lg bg-rose-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Annulation…' : 'Oui, annuler'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="border-ink-300 rounded-lg border bg-white px-4 py-2.5 text-sm font-medium"
        >
          Revenir
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-rose-800">
          {error}
        </p>
      )}
    </div>
  );
}
