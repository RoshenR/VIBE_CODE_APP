'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SelectField, TextareaField, TextField, CheckboxField } from '@/components/ui/fields';
import { InlineAlert } from '@/components/ui/states';
import type { FormState } from './event-actions';

const TIMEZONES: { value: string; label: string }[] = [
  { value: 'Europe/Paris', label: 'Paris — heure de la France' },
  { value: 'Europe/London', label: 'Londres' },
  { value: 'Europe/Lisbon', label: 'Lisbonne' },
  { value: 'Europe/Madrid', label: 'Madrid' },
  { value: 'Europe/Berlin', label: 'Berlin' },
  { value: 'America/Montreal', label: 'Montréal' },
  { value: 'America/New_York', label: 'New York' },
  { value: 'UTC', label: 'UTC' },
];

export interface EventFormValues {
  title: string;
  description: string;
  venueName: string;
  venueAddress: string;
  isOnline: boolean;
  onlineUrl: string;
  timezone: string;
  /** Heure murale du lieu, au format `datetime-local`. */
  startsAt: string;
  doorsAt: string;
  holdMinutesCard: number;
  holdHoursTransfer: number;
  waitlistOfferHours: number;
  cancellationDeadlineHours: number;
}

const EMPTY: EventFormValues = {
  title: '',
  description: '',
  venueName: '',
  venueAddress: '',
  isOnline: false,
  onlineUrl: '',
  timezone: 'Europe/Paris',
  startsAt: '',
  doorsAt: '',
  holdMinutesCard: 15,
  holdHoursTransfer: 72,
  waitlistOfferHours: 6,
  cancellationDeadlineHours: 48,
};

/**
 * Formulaire d'événement, regroupé par intention : ce qu'est l'événement, où il a
 * lieu, quand, et comment se comportent les réservations.
 *
 * Les champs sont non contrôlés (`defaultValue`) : l'envoi passe par une action
 * serveur, et l'état de la saisie n'a pas besoin de vivre dans React. Le retour
 * d'enregistrement — succès comme erreur — est annoncé et reçoit le focus.
 */
export function EventForm({
  action,
  initial = EMPTY,
  submitLabel,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  initial?: EventFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [isOnline, setIsOnline] = useState(initial.isOnline);
  const feedbackRef = useRef<HTMLDivElement>(null);

  // Le retour d'enregistrement apparaît parfois hors de l'écran, sous un long
  // formulaire : on l'y amène plutôt que de laisser croire que rien ne s'est passé.
  useEffect(() => {
    if (state.error || state.ok) feedbackRef.current?.focus();
  }, [state]);

  return (
    <form action={formAction} className="space-y-6">
      <Section title="L'événement">
        <TextField name="title" label="Titre" defaultValue={initial.title} required maxLength={160} />
        <TextareaField
          name="description"
          label="Description"
          defaultValue={initial.description}
          optional
          hint="Affichée sur la page publique. Un retour à la ligne crée un nouveau paragraphe."
        />
      </Section>

      <Section title="Lieu">
        <CheckboxField
          label="Événement en ligne"
          hint="Aucune adresse n'est alors demandée."
          name="isOnline"
          defaultChecked={initial.isOnline}
          onChange={(e) => setIsOnline(e.target.checked)}
        />
        {isOnline ? (
          <TextField
            name="onlineUrl"
            label="Lien de diffusion"
            type="url"
            defaultValue={initial.onlineUrl}
            hint="Communiqué aux participants avant le début ; jamais affiché publiquement."
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField name="venueName" label="Salle" defaultValue={initial.venueName} optional />
            <TextField name="venueAddress" label="Adresse" defaultValue={initial.venueAddress} optional />
          </div>
        )}
      </Section>

      <Section
        title="Date et heure"
        description="Saisissez les horaires dans l'heure locale du lieu. Ils sont convertis automatiquement pour les participants situés ailleurs."
      >
        <SelectField
          name="timezone"
          label="Fuseau horaire du lieu"
          defaultValue={initial.timezone}
          fieldClassName="sm:max-w-sm"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </SelectField>

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField name="startsAt" label="Début" type="datetime-local" defaultValue={initial.startsAt} required />
          <TextField
            name="doorsAt"
            label="Ouverture des portes"
            type="datetime-local"
            defaultValue={initial.doorsAt}
            optional
          />
        </div>
      </Section>

      <Section
        title="Réservations"
        description="Combien de temps une réservation non payée garde-t-elle ses places ? Un virement demande nettement plus de temps qu'une carte."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            name="holdMinutesCard"
            label="Délai de paiement par carte"
            type="number"
            inputMode="numeric"
            min={2}
            max={1440}
            defaultValue={initial.holdMinutesCard}
            hint="En minutes. Passé ce délai, les places repartent à la vente."
          />
          <TextField
            name="holdHoursTransfer"
            label="Délai de paiement par virement"
            type="number"
            inputMode="numeric"
            min={1}
            max={720}
            defaultValue={initial.holdHoursTransfer}
            hint="En heures."
          />
          <TextField
            name="waitlistOfferHours"
            label="Délai de réponse en liste d'attente"
            type="number"
            inputMode="numeric"
            min={1}
            max={168}
            defaultValue={initial.waitlistOfferHours}
            hint="En heures. Pendant ce délai, les places sont réservées pour la personne."
          />
          <TextField
            name="cancellationDeadlineHours"
            label="Annulation en ligne possible jusqu'à"
            type="number"
            inputMode="numeric"
            min={0}
            max={720}
            defaultValue={initial.cancellationDeadlineHours}
            hint="En heures avant le début. 0 : jusqu'au début de l'événement."
          />
        </div>
      </Section>

      <div ref={feedbackRef} tabIndex={-1} className="outline-none" aria-live="polite">
        {state.error && <InlineAlert tone="danger" title="Enregistrement impossible">{state.error}</InlineAlert>}
        {state.ok && <InlineAlert tone="success" title="Modifications enregistrées." />}
      </div>

      <Button type="submit" size="lg" loading={pending}>
        {pending ? 'Enregistrement…' : submitLabel}
      </Button>
    </form>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="border-rule bg-paper shadow-panel rounded-panel border p-5 sm:p-6">
      <legend className="sr-only">{title}</legend>
      <h3 className="display text-display-sm" aria-hidden="true">
        {title}
      </h3>
      {description && <p className="text-ink-soft mt-1.5 text-[0.9375rem]">{description}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </fieldset>
  );
}
