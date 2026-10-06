import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { requirePermission } from '@/lib/org';
import { createEventAction } from '../event-actions';
import { EventForm } from '../event-form';

export const metadata: Metadata = { title: 'Nouvel événement' };

/**
 * Création d'un événement.
 *
 * Réservée aux responsables : la page elle-même vérifie le droit, pas seulement
 * l'action d'envoi. Sans cela, un compte « équipe » verrait un formulaire qui
 * échouerait à la soumission — une fausse promesse.
 */
export default async function NewEventPage() {
  await requirePermission('evenement.creer');

  return (
    <div>
      <nav aria-label="Fil d'Ariane" className="text-ink-muted flex items-center gap-1.5 text-sm">
        <Link href="/admin" className="hover:text-ink inline-flex min-h-11 items-center underline-offset-4 hover:underline">
          Événements
        </Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <span className="text-ink-soft font-medium" aria-current="page">
          Nouvel événement
        </span>
      </nav>

      <h1 className="display text-display-lg mt-3">Nouvel événement</h1>
      <p className="text-ink-soft measure mt-3">
        L&apos;événement est créé en <strong>brouillon</strong> : invisible du public. Vous ajoutez
        ensuite ses catégories de places, puis vous ouvrez la vente quand tout est prêt.
      </p>

      <div className="mt-8 max-w-3xl">
        <EventForm action={createEventAction} submitLabel="Créer l'événement" />
      </div>
    </div>
  );
}
