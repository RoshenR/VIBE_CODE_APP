'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { cancelOrderAction } from '@/app/admin/actions';
import { formatCents } from '@/lib/money';

/**
 * Annulation d'une commande par l'équipe.
 *
 * Le dialogue nomme la commande et dit ce que l'action fait — et ne fait PAS :
 * pour une commande payée, l'outil enregistre le remboursement, il ne vire rien.
 * Laisser croire le contraire exposerait l'équipe à promettre un remboursement
 * qui ne partirait jamais.
 */
export function OrderRowActions({
  orderId,
  eventId,
  reference,
  customerName,
  totalCents,
  paid,
}: {
  orderId: string;
  eventId: string;
  reference: string;
  customerName: string;
  totalCents: number;
  paid: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Une commande gratuite n'a rien à rembourser.
  const refund = paid && totalCents > 0;

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-label={`Annuler la commande ${reference}`}
      >
        Annuler
      </Button>

      <ConfirmDialog
        open={open}
        onClose={() => {
          if (!pending) {
            setOpen(false);
            setError(null);
          }
        }}
        title={`Annuler la commande ${reference} ?`}
        description={
          refund
            ? `Commande de ${customerName}, ${formatCents(totalCents)}. Les billets seront invalidés et les places remises en vente. Le remboursement est ENREGISTRÉ dans l'outil : aucun virement n'est exécuté, c'est à vous de rembourser ${customerName}.`
            : paid
              ? `Commande gratuite de ${customerName}. Les billets seront invalidés et les places remises en vente.`
              : `Commande de ${customerName}, non payée. Les places seront remises en vente. Aucun montant n'a été débité.`
        }
        confirmLabel={refund ? "Annuler et enregistrer le remboursement" : 'Annuler la commande'}
        cancelLabel="Garder la commande"
        busy={pending}
        error={error}
        onConfirm={() =>
          startTransition(async () => {
            const result = await cancelOrderAction(orderId, eventId);
            if (result.ok) {
              setOpen(false);
              setError(null);
            } else {
              setError(result.error ?? "L'annulation a échoué.");
            }
          })
        }
      />
    </>
  );
}
