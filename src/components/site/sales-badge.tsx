import { StatusBadge, type Surface } from '@/components/ui/badge';
import { formatShort } from '@/lib/dates';
import { LOW_STOCK_THRESHOLD, type SalesState } from '@/lib/programme';

/**
 * État de la vente d'un événement, en un badge.
 *
 * Tout vient de l'état réel du serveur (stocks, fenêtres de vente) : « Plus que
 * 3 places » n'apparaît que s'il en reste exactement 3, et jamais pour créer de
 * l'urgence là où il n'y en a pas. Le seuil d'alerte est celui de la page de
 * réservation (`LOW_STOCK_THRESHOLD`).
 */
export function SalesBadge({
  state,
  available,
  opensAt,
  timezone,
  surface = 'ivory',
}: {
  state: SalesState;
  available: number;
  opensAt: Date | null;
  timezone: string;
  surface?: Surface;
}) {
  switch (state) {
    case 'open':
      return available <= LOW_STOCK_THRESHOLD ? (
        <StatusBadge tone="warning" surface={surface}>
          Plus que {available} place{available > 1 ? 's' : ''}
        </StatusBadge>
      ) : (
        <StatusBadge tone="success" surface={surface}>
          Billets disponibles
        </StatusBadge>
      );
    case 'soldout':
      return (
        <StatusBadge tone="danger" surface={surface}>
          Complet
        </StatusBadge>
      );
    case 'closed':
      return (
        <StatusBadge tone="neutral" surface={surface}>
          Ventes terminées
        </StatusBadge>
      );
    case 'upcoming':
      return (
        <StatusBadge tone="info" surface={surface}>
          {opensAt ? `Ouverture le ${formatShort(opensAt, timezone)}` : 'Bientôt en vente'}
        </StatusBadge>
      );
  }
}
