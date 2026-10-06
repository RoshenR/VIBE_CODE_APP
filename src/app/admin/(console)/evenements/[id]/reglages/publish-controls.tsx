'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ExternalLink, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/badge';
import { InlineAlert } from '@/components/ui/states';
import { setStatusAction } from '../../event-actions';

/**
 * Ouverture et suspension de la vente.
 *
 * Publier rend l'événement visible du public et ouvre l'achat : le geste mérite
 * une confirmation qui dit ce qui va se passer. La suspension, elle, ne casse
 * rien — les commandes existantes restent valides, seule la page publique et
 * les nouvelles réservations disparaissent.
 */
export function PublishControls({
  eventId,
  slug,
  status,
  hasTicketTypes,
}: {
  eventId: string;
  slug: string;
  status: string;
  hasTicketTypes: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<'publish' | 'suspend' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const published = status === 'published';

  function apply(next: 'draft' | 'published'): void {
    startTransition(async () => {
      const result = await setStatusAction(eventId, next);
      if (result.error) {
        setError(result.error);
      } else {
        setError(null);
        setConfirm(null);
      }
    });
  }

  return (
    <section
      aria-labelledby="vente-titre"
      className="border-rule bg-paper shadow-panel rounded-panel border p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <h2 id="vente-titre" className="display text-display-sm">
            Mise en vente
          </h2>
          <div className="mt-3">
            {published ? (
              <StatusBadge tone="success" icon={Eye}>
                En vente — visible du public
              </StatusBadge>
            ) : (
              <StatusBadge tone="neutral" icon={EyeOff}>
                {status === 'cancelled' ? 'Événement annulé' : 'Brouillon — invisible du public'}
              </StatusBadge>
            )}
          </div>
          <p className="text-ink-soft mt-3 max-w-prose text-[0.9375rem]">
            {published
              ? 'Les visiteurs peuvent réserver. Vous pouvez suspendre la vente à tout moment : les commandes déjà passées restent valides.'
              : hasTicketTypes
                ? 'Rien n’est visible tant que la vente n’est pas ouverte.'
                : 'Ajoutez au moins une catégorie de place pour pouvoir ouvrir la vente.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {published && (
            <Link
              href={`/e/${slug}`}
              target="_blank"
              rel="noopener"
              className="text-ink-soft hover:text-ink inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline underline-offset-4"
            >
              Voir la page publique
              <ExternalLink className="size-3.5" aria-hidden />
              <span className="sr-only">(s&apos;ouvre dans un nouvel onglet)</span>
            </Link>
          )}
          {published ? (
            <Button variant="secondary" onClick={() => setConfirm('suspend')}>
              Suspendre la vente
            </Button>
          ) : (
            <Button disabled={!hasTicketTypes || status === 'cancelled'} onClick={() => setConfirm('publish')}>
              Ouvrir la vente
            </Button>
          )}
        </div>
      </div>

      {error && !confirm && (
        <InlineAlert tone="danger" className="mt-5">
          {error}
        </InlineAlert>
      )}

      <ConfirmDialog
        open={confirm === 'publish'}
        onClose={() => {
          if (!pending) {
            setConfirm(null);
            setError(null);
          }
        }}
        tone="primary"
        title="Ouvrir la vente ?"
        description="L'événement devient visible sur la programmation et les visiteurs peuvent réserver tout de suite. Vérifiez une dernière fois les dates, les prix et les jauges."
        confirmLabel="Ouvrir la vente"
        cancelLabel="Pas encore"
        busy={pending}
        error={error}
        onConfirm={() => apply('published')}
      />

      <ConfirmDialog
        open={confirm === 'suspend'}
        onClose={() => {
          if (!pending) {
            setConfirm(null);
            setError(null);
          }
        }}
        title="Suspendre la vente ?"
        description="L'événement disparaît de la programmation et plus personne ne peut réserver. Les commandes déjà passées et leurs billets restent valides."
        confirmLabel="Suspendre la vente"
        cancelLabel="Garder en vente"
        busy={pending}
        error={error}
        onConfirm={() => apply('draft')}
      />
    </section>
  );
}
