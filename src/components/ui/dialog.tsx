'use client';

import { useEffect, useId, useRef } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from './button';
import { InlineAlert } from './states';

/**
 * Dialogue de confirmation, sur l'élément natif <dialog>.
 *
 * L'élément natif apporte, sans une ligne de gestion maison : le piégeage du
 * focus, l'inertie du reste de la page, la fermeture par Échap et la restitution
 * du focus à l'élément qui l'a ouvert. Réécrire tout cela en JavaScript serait
 * moins fiable.
 *
 * Le bouton « Annuler » reçoit le focus à l'ouverture : devant une action
 * destructrice, la touche Entrée ne doit jamais confirmer par réflexe.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Annuler',
  tone = 'danger',
  busy = false,
  error,
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      // Pendant une action en cours, Échap ne doit pas faire croire qu'on l'a annulée.
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      // Un clic sur le voile (le <dialog> lui-même, sans marge) ferme la boîte.
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="border-rule bg-paper shadow-lift rounded-panel border p-6">
        <div className="flex items-start gap-4">
          {tone === 'danger' && (
            <span className="bg-danger-wash text-danger-ink grid size-11 shrink-0 place-items-center rounded-control">
              <TriangleAlert className="size-5" aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <h2 id={titleId} className="display text-display-sm">
              {title}
            </h2>
            {description && (
              <p id={descId} className="text-ink-soft mt-2 text-[0.9375rem]">
                {description}
              </p>
            )}
          </div>
        </div>

        {children && <div className="mt-4">{children}</div>}

        {error && <InlineAlert tone="danger" className="mt-4">{error}</InlineAlert>}

        {/* Libellés parfois longs : si les deux boutons ne tiennent pas côte à côte, la
            confirmation passe au-dessus (wrap-reverse) et chaque libellé peut se replier. */}
        <div className="mt-6 flex flex-wrap-reverse justify-end gap-3">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={busy}
            autoFocus
            className="h-auto! min-h-12 max-w-full whitespace-normal! py-2.5 leading-snug"
          >
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={busy}
            className="h-auto! min-h-12 max-w-full whitespace-normal! py-2.5 leading-snug"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
