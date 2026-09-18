'use client';

import { useState } from 'react';

export function OfferForm({
  token,
  defaultName,
  defaultEmail,
}: {
  token: string;
  defaultName: string;
  defaultEmail: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'transfer'>('card');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (busy) return;

    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/liste-attente/${token}/accepter`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: data.get('name'),
          email: data.get('email'),
          phone: data.get('phone') || null,
          paymentMethod,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'Confirmation impossible.');
        return;
      }
      window.location.href = result.redirectTo;
    } catch {
      setError('Connexion interrompue. Réessayez.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-ink-200 mt-5 rounded-2xl border bg-white p-5"
    >
      <h2 className="text-ink-900 font-semibold">Confirmer ma place</h2>

      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor="of-name" className="text-ink-700 block text-sm font-medium">
            Nom et prénom
          </label>
          <input
            id="of-name"
            name="name"
            defaultValue={defaultName}
            required
            className="border-ink-300 focus:border-ink-500 mt-1 w-full rounded-lg border px-3 py-2.5 text-base outline-none"
          />
        </div>
        <div>
          <label htmlFor="of-email" className="text-ink-700 block text-sm font-medium">
            E-mail
          </label>
          <input
            id="of-email"
            name="email"
            type="email"
            defaultValue={defaultEmail}
            required
            className="border-ink-300 focus:border-ink-500 mt-1 w-full rounded-lg border px-3 py-2.5 text-base outline-none"
          />
        </div>
        <div>
          <label htmlFor="of-phone" className="text-ink-700 block text-sm font-medium">
            Téléphone (facultatif)
          </label>
          <input
            id="of-phone"
            name="phone"
            type="tel"
            className="border-ink-300 focus:border-ink-500 mt-1 w-full rounded-lg border px-3 py-2.5 text-base outline-none"
          />
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="text-ink-700 text-sm font-medium">Moyen de paiement</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(
            [
              ['card', 'Carte bancaire'],
              ['transfer', 'Virement'],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`cursor-pointer rounded-xl border px-3 py-3 text-center text-sm font-medium ${
                paymentMethod === value
                  ? 'border-ink-900 bg-ink-50'
                  : 'border-ink-200 hover:border-ink-300'
              }`}
            >
              <input
                type="radio"
                name="paymentMethod"
                value={value}
                checked={paymentMethod === value}
                onChange={() => setPaymentMethod(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="bg-ink-900 hover:bg-ink-800 mt-4 w-full rounded-xl px-5 py-3.5 font-semibold text-white disabled:opacity-60"
      >
        {busy ? 'Confirmation…' : 'Confirmer et payer'}
      </button>
    </form>
  );
}
