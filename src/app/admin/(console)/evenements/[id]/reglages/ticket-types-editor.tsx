'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { FillMeter } from '@/components/admin/fill-meter';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { CheckboxField, TextField } from '@/components/ui/fields';
import { InlineAlert } from '@/components/ui/states';
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

/**
 * Catégories de places : prix, jauge, tarif early.
 *
 * La jauge ne peut jamais descendre sous le nombre de places déjà retenues ou
 * vendues — le serveur le refuse, et le formulaire l'indique avant même l'envoi.
 * Une catégorie qui a déjà des réservations ne peut plus être supprimée.
 */
export function TicketTypesEditor({
  eventId,
  ticketTypes,
}: {
  eventId: string;
  ticketTypes: TicketTypeRow[];
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(ticketTypes.length === 0 ? 'new' : null);

  return (
    <div className="space-y-4">
      {ticketTypes.map((type) =>
        editing === type.id ? (
          <TicketTypeForm key={type.id} eventId={eventId} row={type} onDone={() => setEditing(null)} />
        ) : (
          <TicketTypeCard key={type.id} eventId={eventId} row={type} onEdit={() => setEditing(type.id)} />
        ),
      )}

      {editing === 'new' ? (
        <TicketTypeForm eventId={eventId} row={null} onDone={() => setEditing(null)} />
      ) : (
        <Button variant="secondary" block onClick={() => setEditing('new')}>
          <Plus className="size-5" aria-hidden />
          Ajouter une catégorie de place
        </Button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

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
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = row.quantityReserved > 0;
  const held = Math.max(0, row.quantityReserved - row.quantitySold);

  return (
    <article className="border-rule bg-paper shadow-panel rounded-panel border p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">{row.name}</h3>
          {row.description && <p className="text-ink-soft mt-0.5 text-sm">{row.description}</p>}
          <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="display text-display-sm tabular-nums">{formatEuros(row.priceEuros)}</span>
            {row.earlyPriceEuros && (
              <span className="text-copper-ink text-sm font-semibold">
                tarif early {formatEuros(row.earlyPriceEuros)}
                {row.earlyEndsAt && ` jusqu'au ${formatInputDate(row.earlyEndsAt)}`}
              </span>
            )}
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onEdit} aria-label={`Modifier ${row.name}`}>
            <Pencil className="size-4" aria-hidden />
            Modifier
          </Button>
          {!locked && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(true)}
              aria-label={`Supprimer ${row.name}`}
            >
              <Trash2 className="size-4" aria-hidden />
              Supprimer
            </Button>
          )}
        </div>
      </div>

      <FillMeter
        className="mt-5 max-w-md"
        label={`Remplissage de ${row.name}`}
        sold={row.quantitySold}
        held={held}
        capacity={row.quantityTotal}
      />

      {locked && (
        <p className="text-ink-muted mt-3 text-sm">
          Des places sont déjà vendues ou retenues : cette catégorie ne peut plus être supprimée. Vous
          pouvez encore ajuster son prix et sa jauge (jamais sous {row.quantityReserved}).
        </p>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => {
          if (!pending) {
            setConfirming(false);
            setError(null);
          }
        }}
        title={`Supprimer « ${row.name} » ?`}
        description="Cette catégorie n'a encore aucune réservation. Elle disparaîtra de la page de l'événement."
        confirmLabel="Supprimer la catégorie"
        cancelLabel="Garder"
        busy={pending}
        error={error}
        onConfirm={() =>
          startTransition(async () => {
            const result = await deleteTicketTypeAction(eventId, row.id);
            if (result.error) setError(result.error);
            else setConfirming(false);
          })
        }
      />
    </article>
  );
}

/* -------------------------------------------------------------------------- */

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
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, { error: null });
  const [hasEarly, setHasEarly] = useState(Boolean(row?.earlyPriceEuros));
  const errorRef = useRef<HTMLDivElement>(null);

  // Enregistré : on referme. Fait dans un effet — jamais pendant le rendu.
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state.error]);

  const minimum = row ? Math.max(row.quantityReserved, 1) : 1;

  return (
    <form
      action={formAction}
      className="border-ink bg-paper shadow-lift rounded-panel border-2 p-5 sm:p-6"
      aria-label={row ? `Modifier la catégorie ${row.name}` : 'Nouvelle catégorie de place'}
    >
      <h3 className="display text-display-sm">
        {row ? `Modifier « ${row.name} »` : 'Nouvelle catégorie'}
      </h3>

      <div className="mt-5 space-y-5">
        <TextField
          name="name"
          label="Nom"
          defaultValue={row?.name ?? ''}
          placeholder="Fosse, Balcon, Standard, VIP…"
          required
          maxLength={80}
        />
        <TextField
          name="description"
          label="Description"
          defaultValue={row?.description ?? ''}
          optional
          maxLength={500}
        />

        <div className="grid gap-5 sm:grid-cols-3">
          <TextField
            name="price"
            label="Prix (€)"
            inputMode="decimal"
            defaultValue={row?.priceEuros ?? ''}
            placeholder="22"
            required
            hint="0 pour une place gratuite."
          />
          <TextField
            name="quantityTotal"
            label="Jauge"
            type="number"
            inputMode="numeric"
            min={minimum}
            defaultValue={row?.quantityTotal ?? ''}
            required
            hint={
              row && row.quantityReserved > 0
                ? `Minimum ${row.quantityReserved} : places déjà retenues ou vendues.`
                : 'Nombre de places de cette catégorie.'
            }
          />
          <TextField
            name="maxPerOrder"
            label="Maximum par commande"
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            defaultValue={row?.maxPerOrder ?? 6}
          />
        </div>

        <div className="border-rule rounded-control border p-4">
          <CheckboxField
            label="Tarif early"
            hint="S'applique automatiquement jusqu'à la date choisie, puis bascule seul au tarif normal."
            checked={hasEarly}
            onChange={(e) => setHasEarly(e.target.checked)}
          />
          {hasEarly && (
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <TextField
                name="earlyPrice"
                label="Prix early (€)"
                inputMode="decimal"
                defaultValue={row?.earlyPriceEuros ?? ''}
                placeholder="16"
              />
              <TextField
                name="earlyEndsAt"
                label="Jusqu'au"
                type="datetime-local"
                defaultValue={row?.earlyEndsAt ?? ''}
                hint="Heure locale du lieu."
              />
            </div>
          )}
        </div>
      </div>

      <div ref={errorRef} tabIndex={-1} className="outline-none" aria-live="polite">
        {state.error && (
          <InlineAlert tone="danger" title="Enregistrement impossible" className="mt-5">
            {state.error}
          </InlineAlert>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="submit" loading={pending}>
          {pending ? 'Enregistrement…' : 'Enregistrer la catégorie'}
        </Button>
        <Button variant="secondary" onClick={onDone} disabled={pending}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

function formatEuros(value: string): string {
  const amount = Number.parseFloat(value);
  if (Number.isNaN(amount)) return '—';
  return amount === 0
    ? 'Gratuit'
    : new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      }).format(amount);
}

/** « 2026-10-13T20:30 » (heure murale du lieu) → « 13 oct. 2026, 20 h 30 ». */
function formatInputDate(value: string): string {
  const [date, time] = value.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time ?? '00:00').split(':').map(Number);
  const day = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
  return `${day}, ${mm === 0 ? `${hh} h` : `${hh} h ${String(mm).padStart(2, '0')}`}`;
}
