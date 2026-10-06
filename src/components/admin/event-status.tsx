import { Archive, CircleCheck, CircleX, Pencil } from 'lucide-react';
import { StatusBadge, type Surface } from '@/components/ui/badge';

/** Statut d'un événement : toujours un mot et un pictogramme, jamais la seule couleur. */
export function EventStatusBadge({
  status,
  surface = 'ivory',
}: {
  status: string;
  surface?: Surface;
}) {
  switch (status) {
    case 'published':
      return (
        <StatusBadge tone="success" icon={CircleCheck} surface={surface}>
          En vente
        </StatusBadge>
      );
    case 'draft':
      return (
        <StatusBadge tone="neutral" icon={Pencil} surface={surface}>
          Brouillon — invisible du public
        </StatusBadge>
      );
    case 'cancelled':
      return (
        <StatusBadge tone="danger" icon={CircleX} surface={surface}>
          Annulé
        </StatusBadge>
      );
    default:
      return (
        <StatusBadge tone="neutral" icon={Archive} surface={surface}>
          Archivé
        </StatusBadge>
      );
  }
}
