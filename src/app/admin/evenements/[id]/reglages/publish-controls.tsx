'use client';

import { useState, useTransition } from 'react';
import { setStatusAction } from '../../event-actions';

/**
 * Ouverture et fermeture de la vente.
 *
 * Publier est le geste qui rend un événement visible du public : il mérite un
 * bouton explicite, pas une case à cocher perdue dans un formulaire.
 */
export function PublishControls({
  eventId,
  status,
  hasTicketTypes,
}: {
  eventId: string;
  status: string;
  hasTicketTypes: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(next: 'draft' | 'published' | 'cancelled'): void {
    startTransition(async () => {
      const result = await setStatusAction(eventId, next);
      setError(result.error);
    });
  }

  return (
    <div className="border-ink-200 mt-6 rounded-2xl border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-ink-900 font-medium">
            {status === 'published'
              ? 'En vente'
              : status === 'cancelled'
                ? 'Événement annulé'
                : 'Brouillon'}
          </p>
          <p className="text-ink-500 mt-0.5 text-sm">
            {status === 'published'
              ? 'Visible du public, les places sont achetables.'
              : status === 'cancelled'
                ? "L'événement n'apparaît plus publiquement."
                : hasTicketTypes
                  ? 'Invisible du public tant que la vente n’est pas ouverte.'
                  : 'Ajoutez une catégorie de place pour pouvoir ouvrir la vente.'}
          </p>
        </div>

        {status === 'published' ? (
          <button
            type="button"
            onClick={() => change('draft')}
            disabled={pending}
            className="border-ink-300 text-ink-700 rounded-xl border px-4 py-2.5 text-sm font-medium disabled:opacity-50"
          >
            Suspendre la vente
          </button>
        ) : (
          <button
            type="button"
            onClick={() => change('published')}
            disabled={pending || !hasTicketTypes}
            className="bg-ink-900 hover:bg-ink-800 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Ouvrir la vente
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
