'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';

/**
 * Annulation autonome par le client.
 *
 * Passe par une boîte de dialogue plutôt qu'un simple bouton : le geste est
 * irréversible et les places repartent immédiatement à la vente. Le texte dit
 * aussi, sans détour, ce qu'il advient de l'argent — jamais plus que ce que le
 * système fait réellement.
 */
export function CancelButton({ token, wasPaid }: { token: string; wasPaid: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/commande/${token}/annuler`, { method: 'POST' });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(result.error ?? 'Annulation impossible pour le moment. Réessayez dans un instant.');
        setBusy(false);
        return;
      }

      setOpen(false);
      setBusy(false);
      router.refresh();
    } catch {
      setError('Connexion interrompue : la commande n’a pas été annulée. Réessayez.');
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Annuler ma commande
      </Button>

      <ConfirmDialog
        open={open}
        onClose={() => {
          if (!busy) {
            setOpen(false);
            setError(null);
          }
        }}
        title="Annuler cette commande ?"
        description={
          wasPaid
            ? "Vos billets seront invalidés et vos places remises en vente. L'annulation est enregistrée : l'équipe organisatrice effectue ensuite le remboursement, il n'est pas automatique."
            : "Vos places seront remises en vente. Aucun montant n'a été débité."
        }
        confirmLabel="Oui, annuler la commande"
        cancelLabel="Garder ma commande"
        busy={busy}
        error={error}
        onConfirm={cancel}
      />
    </>
  );
}
