'use client';

import { useActionState, useState, useTransition } from 'react';
import { deleteTicketTypeAction, saveTicketTypeAction, type FormState } from '../../event-actions';

export interface TicketTypeRow {
  id: string;
  name: string;
  description: string;
  priceEuros: string;
  earlyPriceEuros: string;
  earlyEndsAt: string;
  quantityTotal: number;
  quantityReserved: number;
  quantitySold: number;
  maxPerOrder: number;
}

export function TicketTypesEditor({
  eventId,
  ticketTypes,
}: {
  eventId: string;
  ticketTypes: TicketTypeRow[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(ticketTypes.length === 0);

  return (
    <div className="mt-4 space-y-3">
      {ticketTypes.map((type) =>
        editing === type.id ? (
          <TicketTypeForm
            key={type.id}
            eventId={eventId}
            row={type}
            onDone={() => setEditing(null)}
          />
        ) : (
          <TicketTypeCard
            key={type.id}
            eventId={eventId}
            row={type}
            onEdit={() => setEditing(type.id)}
          />
        ),
      )}

      {adding ? (
        <TicketTypeForm eventId={eventId} row={null} onDone={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="border-ink-300 text-ink-600 hover:border-ink-400 w-full rounded-2xl border border-dashed px-5 py-4 text-sm font-medium"
        >
          + Ajouter une catégorie de place
        </button>
      )}
    </div>
  );
}

function TicketTypeCard({
  eventId,
  row,
  onEdit,
}: {
  eventId: string;
  row: TicketTypeRow;
  onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const locked = row.quantityReserved > 0;

  return (
    <div className="border-ink-200 rounded-2xl border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-ink-900 font-medium">{row.name}</h3>
          {row.description && (
            <p className="text-ink-500 mt-0.5 text-sm">{row.description}</p>
          )}
          <p className="text-ink-600 mt-2 text-sm">
            {row.priceEuros} €
            {row.earlyPriceEuros && (
              <span className="ml-2 text-emerald-700">
                early {row.earlyPriceEuros} €
              </span>
            )}
          </p>
          <p className="text-ink-400 mt-1 text-xs tabular-nums">
            {row.quantitySold} vendue(s) · {row.quantityReserved - row.quantitySold} en
            attente · {row.quantityTotal - row.quantityReserved} restante(s) sur{' '}
            {row.quantityTotal}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="border-ink-300 text-ink-700 rounded-lg border px-3 py-2 text-sm"
          >
            Modifier
          </button>
          {!locked && !confirming && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-ink-500 hover:text-rose-700 rounded-lg px-2 py-2 text-sm"
            >
              Supprimer
            </button>
          )}
        </div>
      </div>

      {confirming && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3">
          <span className="text-sm text-rose-900">Supprimer cette catégorie ?</span>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteTicketTypeAction(eventId, row.id);
                setError(result.error);
                setConfirming(false);
              })
            }
            className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Oui
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="border-ink-300 rounded-lg border bg-white px-3 py-1.5 text-xs"
          >
            Non
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

function TicketTypeForm({
  eventId,
  row,
  onDone,
}: {
  eventId: string;
  row: TicketTypeRow | null;
  onDone: () => void;
}) {
  const action = saveTicketTypeAction.bind(null, eventId, row?.id ?? null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {
    error: null,
  });
  const [hasEarly, setHasEarly] = useState(Boolean(row?.earlyPriceEuros));

  // Le serveur a confirmé : on referme le formulaire.
  if (state.ok) {
    queueMicrotask(onDone);
  }

  return (
    <form action={formAction} className="border-ink-400 rounded-2xl border bg-white p-5">
      <h3 className="text-ink-900 font-medium">
        {row ? `Modifier « ${row.name} »` : 'Nouvelle catégorie'}
      </h3>

      <div className="mt-4 space-y-4">
        <Field
          name="name"
          label="Nom"
          defaultValue={row?.name ?? ''}
          placeholder="Fosse, Balcon, Standard, VIP…"
          required
        />
        <Field
          name="description"
          label="Description (facultatif)"
          defaultValue={row?.description ?? ''}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="price"
            label="Prix (€)"
            type="text"
            inputMode="decimal"
            defaultValue={row?.priceEuros ?? ''}
            placeholder="22"
            required
          />
          <Field
            name="quantityTotal"
            label="Jauge"
            type="number"
            min={row ? Math.max(row.quantityReserved, 1) : 1}
            defaultValue={row?.quantityTotal ?? ''}
            required
            hint={
              row && row.quantityReserved > 0
                ? `Minimum ${row.quantityReserved} : places déjà réservées.`
                : undefined
            }
          />
        </div>

        <Field
          name="maxPerOrder"
          label="Maximum par commande"
          type="number"
          min={1}
          max={50}
          defaultValue={row?.maxPerOrder ?? 6}
        />

        <div className="border-ink-200 rounded-xl border p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={hasEarly}
              onChange={(e) => setHasEarly(e.target.checked)}
              className="h-4 w-4"
            />
            Tarif early
          </label>
          <p className="text-ink-500 mt-1 text-xs">
            Appliqué automatiquement jusqu&apos;à la date choisie, puis bascule seul au
            tarif normal.
          </p>

          {hasEarly && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field
                name="earlyPrice"
                label="Prix early (€)"
                type="text"
                inputMode="decimal"
                defaultValue={row?.earlyPriceEuros ?? ''}
                placeholder="16"
              />
              <Field
                name="earlyEndsAt"
                label="Jusqu'au"
                type="datetime-local"
                defaultValue={row?.earlyEndsAt ?? ''}
              />
            </div>
          )}
        </div>
      </div>

      {state.error && (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="bg-ink-900 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="border-ink-300 rounded-xl border px-5 py-2.5 text-sm font-medium"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  hint,
  ...props
}: { name: string; label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `tt-${name}`;
  return (
    <div>
      <label htmlFor={id} className="text-ink-700 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        className="border-ink-300 focus:border-ink-500 mt-1 w-full rounded-lg border px-3 py-2.5 text-base outline-none"
        {...props}
      />
      {hint && <p className="text-ink-500 mt-1 text-xs">{hint}</p>}
    </div>
  );
}
