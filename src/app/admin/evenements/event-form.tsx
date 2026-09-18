'use client';

import { useActionState, useState } from 'react';
import type { FormState } from './event-actions';

const TIMEZONES = [
  'Europe/Paris',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Berlin',
  'America/Montreal',
  'America/New_York',
  'UTC',
];

export interface EventFormValues {
  title: string;
  description: string;
  venueName: string;
  venueAddress: string;
  isOnline: boolean;
  onlineUrl: string;
  timezone: string;
  startsAt: string; // heure murale du lieu, format datetime-local
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

  return (
    <form action={formAction} className="mt-6 space-y-5">
      <Card title="L'événement">
        <Text name="title" label="Titre" defaultValue={initial.title} required />
        <Area name="description" label="Description" defaultValue={initial.description} />
      </Card>

      <Card title="Lieu">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isOnline"
            defaultChecked={initial.isOnline}
            onChange={(e) => setIsOnline(e.target.checked)}
            className="h-4 w-4"
          />
          Événement en ligne
        </label>

        {isOnline ? (
          <Text
            name="onlineUrl"
            label="Lien de diffusion"
            type="url"
            defaultValue={initial.onlineUrl}
            hint="Communiqué aux participants avant le début, jamais affiché publiquement."
          />
        ) : (
          <>
            <Text name="venueName" label="Salle" defaultValue={initial.venueName} />
            <Text name="venueAddress" label="Adresse" defaultValue={initial.venueAddress} />
          </>
        )}
      </Card>

      <Card
        title="Date et heure"
        hint="Les horaires se saisissent dans l'heure locale du lieu. Ils sont convertis automatiquement pour les participants situés ailleurs."
      >
        <div>
          <label htmlFor="timezone" className="text-ink-700 block text-sm font-medium">
            Fuseau horaire du lieu
          </label>
          <select
            id="timezone"
            name="timezone"
            defaultValue={initial.timezone}
            className="border-ink-300 mt-1 w-full rounded-lg border px-3 py-2.5 text-base"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Text
            name="startsAt"
            label="Début"
            type="datetime-local"
            defaultValue={initial.startsAt}
            required
          />
          <Text
            name="doorsAt"
            label="Ouverture des portes"
            type="datetime-local"
            defaultValue={initial.doorsAt}
          />
        </div>
      </Card>

      <Card
        title="Réservations"
        hint="Combien de temps une réservation non payée garde-t-elle ses places ? Un virement demande nettement plus de temps qu'une carte."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Number
            name="holdMinutesCard"
            label="Délai carte bancaire (minutes)"
            defaultValue={initial.holdMinutesCard}
            min={2}
            max={1440}
          />
          <Number
            name="holdHoursTransfer"
            label="Délai virement (heures)"
            defaultValue={initial.holdHoursTransfer}
            min={1}
            max={720}
          />
          <Number
            name="waitlistOfferHours"
            label="Délai de réponse liste d'attente (heures)"
            defaultValue={initial.waitlistOfferHours}
            min={1}
            max={168}
          />
          <Number
            name="cancellationDeadlineHours"
            label="Annulation possible jusqu'à (heures avant)"
            defaultValue={initial.cancellationDeadlineHours}
            min={0}
            max={720}
          />
        </div>
      </Card>

      {state.error && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Modifications enregistrées.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-ink-900 hover:bg-ink-800 w-full rounded-xl px-5 py-3.5 font-semibold text-white disabled:opacity-60 sm:w-auto"
      >
        {pending ? 'Enregistrement…' : submitLabel}
      </button>
    </form>
  );
}

/* --- Éléments de formulaire ---------------------------------------------- */

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-ink-200 rounded-2xl border bg-white p-5">
      <h2 className="text-ink-900 font-semibold">{title}</h2>
      {hint && <p className="text-ink-500 mt-1 text-sm">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Text({
  name,
  label,
  hint,
  ...props
}: { name: string; label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={name} className="text-ink-700 block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        className="border-ink-300 focus:border-ink-500 mt-1 w-full rounded-lg border px-3 py-2.5 text-base outline-none"
        {...props}
      />
      {hint && <p className="text-ink-500 mt-1 text-xs">{hint}</p>}
    </div>
  );
}

function Number({
  name,
  label,
  ...props
}: { name: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={name} className="text-ink-700 block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="number"
        inputMode="numeric"
        className="border-ink-300 focus:border-ink-500 mt-1 w-full rounded-lg border px-3 py-2.5 text-base outline-none"
        {...props}
      />
    </div>
  );
}

function Area({
  name,
  label,
  ...props
}: { name: string; label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div>
      <label htmlFor={name} className="text-ink-700 block text-sm font-medium">
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        rows={4}
        className="border-ink-300 focus:border-ink-500 mt-1 w-full rounded-lg border px-3 py-2.5 text-base outline-none"
        {...props}
      />
    </div>
  );
}
