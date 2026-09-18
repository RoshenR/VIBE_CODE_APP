'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicTicketType } from '@/server/catalog';

function formatPrice(cents: number): string {
  if (cents === 0) return 'Gratuit';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function BookingForm({
  eventSlug,
  ticketTypes,
  cancellationDeadlineHours,
}: {
  eventSlug: string;
  ticketTypes: PublicTicketType[];
  cancellationDeadlineHours: number;
}) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'transfer'>('card');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, q]) => q > 0)
        .map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity })),
    [quantities],
  );

  const total = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const type = ticketTypes.find((t) => t.id === line.ticketTypeId);
        return sum + (type ? type.priceCents * line.quantity : 0);
      }, 0),
    [lines, ticketTypes],
  );

  function setQuantity(id: string, next: number): void {
    setError(null);
    setQuantities((prev) => ({ ...prev, [id]: next }));
  }

  async function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>): Promise<void> {
    formEvent.preventDefault();
    if (lines.length === 0 || submitting) return;

    setSubmitting(true);
    setError(null);

    const data = new FormData(formEvent.currentTarget);

    try {
      const response = await fetch('/api/hold', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventSlug,
          lines,
          name: data.get('name'),
          email: data.get('email'),
          phone: data.get('phone') || null,
          site_web_secondaire: data.get('site_web_secondaire') || '',
          paymentMethod,
          // Permet d'afficher des horaires justes aux participants à l'étranger.
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? 'Une erreur est survenue.');
        // Plus assez de places : les compteurs affichés sont périmés, on les
        // rafraîchit pour que la personne voie l'état réel.
        if (response.status === 409) {
          setQuantities({});
          router.refresh();
        }
        return;
      }

      window.location.href = result.redirectTo;
    } catch {
      setError('Connexion interrompue. Vérifiez votre réseau et réessayez.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative mt-4">
      {/*
        Champ leurre. Invisible et hors du parcours au clavier pour une personne,
        il est rempli par la plupart des robots de remplissage automatique. Le
        serveur rejette alors la soumission. Filtre gratuit contre le bruit de
        fond — pas une barrière contre un attaquant déterminé.
      */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="site_web_secondaire">Ne pas remplir</label>
        <input
          id="site_web_secondaire"
          name="site_web_secondaire"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <ul className="space-y-3">
        {ticketTypes.map((type) => {
          const quantity = quantities[type.id] ?? 0;
          const max = Math.min(type.maxPerOrder, type.available);

          return (
            <li
              key={type.id}
              className="border-ink-200 rounded-2xl border bg-white p-4 sm:p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-ink-900 font-medium">{type.name}</h3>
                  {type.description && (
                    <p className="text-ink-500 mt-0.5 text-sm">{type.description}</p>
                  )}

                  <p className="mt-2 flex flex-wrap items-baseline gap-2">
                    <span className="text-ink-900 font-semibold">
                      {formatPrice(type.priceCents)}
                    </span>
                    {type.isEarly && (
                      <>
                        <span className="text-ink-400 text-sm line-through">
                          {formatPrice(type.standardPriceCents)}
                        </span>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Tarif early
                        </span>
                      </>
                    )}
                  </p>

                  {type.onSale && type.available <= 10 && (
                    <p className="mt-1.5 text-sm font-medium text-amber-700">
                      Plus que {type.available} place{type.available > 1 ? 's' : ''}
                    </p>
                  )}
                  {!type.onSale && (
                    <p className="text-ink-500 mt-1.5 text-sm">{type.closedReason}</p>
                  )}
                </div>

                {type.onSale && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setQuantity(type.id, Math.max(0, quantity - 1))}
                      disabled={quantity === 0}
                      aria-label={`Retirer une place ${type.name}`}
                      className="border-ink-300 text-ink-700 hover:bg-ink-100 flex h-11 w-11 items-center justify-center rounded-lg border text-xl disabled:opacity-30"
                    >
                      −
                    </button>
                    <span
                      aria-live="polite"
                      className="w-8 text-center text-lg font-semibold tabular-nums"
                    >
                      {quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQuantity(type.id, Math.min(max, quantity + 1))}
                      disabled={quantity >= max}
                      aria-label={`Ajouter une place ${type.name}`}
                      className="border-ink-300 text-ink-700 hover:bg-ink-100 flex h-11 w-11 items-center justify-center rounded-lg border text-xl disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {lines.length > 0 && (
        <div className="mt-6 space-y-5">
          <div className="border-ink-200 rounded-2xl border bg-white p-4 sm:p-5">
            <h3 className="text-ink-900 font-medium">Vos coordonnées</h3>
            <div className="mt-3 space-y-3">
              <Field label="Nom et prénom" name="name" autoComplete="name" required />
              <Field
                label="E-mail"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                hint="Vos billets y seront envoyés."
              />
              <Field
                label="Téléphone (facultatif)"
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
              />
            </div>
          </div>

          <fieldset className="border-ink-200 rounded-2xl border bg-white p-4 sm:p-5">
            <legend className="text-ink-900 px-1 font-medium">Moyen de paiement</legend>
            <div className="mt-2 space-y-2">
              <PaymentChoice
                value="card"
                current={paymentMethod}
                onSelect={setPaymentMethod}
                title="Carte bancaire"
                detail="Paiement immédiat. Vos places sont gardées quelques minutes, le temps de régler."
              />
              <PaymentChoice
                value="transfer"
                current={paymentMethod}
                onSelect={setPaymentMethod}
                title="Virement bancaire"
                detail="Vos places restent bloquées plusieurs jours, le temps que le virement arrive."
              />
            </div>
          </fieldset>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
            >
              {error}
            </div>
          )}

          <div className="border-ink-200 sticky bottom-0 -mx-4 border-t bg-white/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
            <div className="flex items-center justify-between">
              <span className="text-ink-600 text-sm">Total</span>
              <span className="text-xl font-semibold tabular-nums">
                {formatPrice(total)}
              </span>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="bg-ink-900 hover:bg-ink-800 mt-3 w-full rounded-xl px-5 py-3.5 font-semibold text-white transition-colors disabled:opacity-60"
            >
              {submitting ? 'Réservation en cours…' : 'Réserver mes places'}
            </button>
            <p className="text-ink-500 mt-2 text-center text-xs">
              Annulation possible en ligne jusqu&apos;à {cancellationDeadlineHours} h avant
              le début.
            </p>
          </div>
        </div>
      )}
    </form>
  );
}

function Field({
  label,
  name,
  hint,
  ...props
}: {
  label: string;
  name: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `field-${name}`;
  return (
    <div>
      <label htmlFor={id} className="text-ink-700 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="border-ink-300 focus:border-ink-500 mt-1 w-full rounded-lg border px-3 py-2.5 text-base outline-none"
        {...props}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-ink-500 mt-1 text-xs">
          {hint}
        </p>
      )}
    </div>
  );
}

function PaymentChoice({
  value,
  current,
  onSelect,
  title,
  detail,
}: {
  value: 'card' | 'transfer';
  current: string;
  onSelect: (v: 'card' | 'transfer') => void;
  title: string;
  detail: string;
}) {
  const selected = current === value;
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${
        selected ? 'border-ink-900 bg-ink-50' : 'border-ink-200 hover:border-ink-300'
      }`}
    >
      <input
        type="radio"
        name="paymentMethod"
        value={value}
        checked={selected}
        onChange={() => onSelect(value)}
        className="mt-1 h-4 w-4 shrink-0"
      />
      <span>
        <span className="text-ink-900 block text-sm font-medium">{title}</span>
        <span className="text-ink-500 block text-xs leading-relaxed">{detail}</span>
      </span>
    </label>
  );
}
