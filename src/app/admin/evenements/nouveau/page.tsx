import Link from 'next/link';
import { requireUser } from '@/lib/org';
import { createEventAction } from '../event-actions';
import { EventForm } from '../event-form';

export const metadata = { title: 'Nouvel événement' };

export default async function NewEventPage() {
  await requireUser();

  return (
    <div>
      <Link href="/admin" className="text-ink-500 hover:text-ink-800 text-sm">
        ← Tous les événements
      </Link>
      <h1 className="text-ink-900 mt-1 text-xl font-semibold tracking-tight">
        Nouvel événement
      </h1>
      <p className="text-ink-500 mt-1 text-sm">
        L&apos;événement est créé en brouillon. Vous ajouterez les catégories de
        places à l&apos;étape suivante, avant de le mettre en vente.
      </p>

      <EventForm action={createEventAction} submitLabel="Créer l'événement" />
    </div>
  );
}
