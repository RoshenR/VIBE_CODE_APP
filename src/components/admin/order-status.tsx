import { CircleCheck, CircleX, Clock, Hourglass, RotateCcw } from 'lucide-react';
import { StatusBadge } from '@/components/ui/badge';

/**
 * Statut d'une commande, vu de l'équipe.
 *
 * Le libellé « Remboursement enregistré » est volontairement littéral : l'outil
 * enregistre l'annulation d'une commande payée, mais n'exécute AUCUN virement
 * auprès d'un prestataire. Écrire « remboursée » laisserait croire que l'argent
 * est reparti.
 */
export function OrderStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return (
        <StatusBadge tone="warning" icon={Hourglass}>
          À payer
        </StatusBadge>
      );
    case 'paid':
      return (
        <StatusBadge tone="success" icon={CircleCheck}>
          Payée
        </StatusBadge>
      );
    case 'expired':
      return (
        <StatusBadge tone="neutral" icon={Clock}>
          Expirée
        </StatusBadge>
      );
    case 'cancelled':
      return (
        <StatusBadge tone="danger" icon={CircleX}>
          Annulée
        </StatusBadge>
      );
    case 'refunded':
      return (
        <StatusBadge tone="info" icon={RotateCcw}>
          Remboursement enregistré
        </StatusBadge>
      );
    default:
      return <StatusBadge tone="neutral">{status}</StatusBadge>;
  }
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  card: 'Carte',
  transfer: 'Virement',
  free: 'Gratuit',
};
