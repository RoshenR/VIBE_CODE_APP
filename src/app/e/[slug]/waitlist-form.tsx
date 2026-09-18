'use client';

import { useState } from 'react';

/**
 * Inscription à la liste d'attente.
 *
 * Remplace les messages Instagram. Le rang d'inscription est annoncé
 * explicitement : c'est ce que les gens demandaient en écrivant « je suis
 * combientième ? ».
 */
export function WaitlistForm({
  eventId,
  ticketTypes,
}: {
  eventId: string;
  ticketTypes: { id: string; name: string }[];
}) {
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'sending' } | { kind: 'done'; position: number; already: boolean }
  >({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (state.kind === 'sending') return;

    const data = new FormData(e.currentTarget);
    setState({ kind: 'sending' });
    setError(null);

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId,
          ticketTypeId: data.get('ticketTypeId') || null,
          name: data.get('name'),
          email: data.get('email'),
          site_web_secondaire: data.get('site_web_secondaire') || '',
          quantity: Number(data.get('quantity') ?? 1),
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'Inscription impossible.');
        setState({ kind: 'idle' });
        return;
      }

      setState({ kind: 'done', position: result.position, already: result.alreadyRegistered });
    } catch {
      setError('Connexion interrompue. Réessayez.');
      setState({ kind: 'idle' });
    }
  }

  if (state.kind === 'done') {
    return (
      <div
        role="status"
        className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-6"
      >
        <p className="font-medium text-emerald-900">
          {state.already
            ? 'Vous étiez déjà inscrit·e.'
            : "Vous êtes sur la liste d'attente."}
        </p>
        <p className="mt-1 text-sm text-emerald-800">
          Vous êtes en position <strong>n° {state.position}</strong>. Si une place se
          libère, vous recevrez un e-mail avec un lien personnel et un délai pour
          confirmer. Les places vous seront réellement réservées pendant ce délai.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-ink-200 relative mt-4 rounded-2xl border bg-white p-4 sm:p-5"
    >
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

      <h3 className="text-ink-900 font-medium">Être prévenu·e en cas de désistement</h3>

      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor="wl-name" className="text-ink-700 block text-sm font-medium">
            Nom et prénom
          </label>
          <input
            id="wl-name"
            name="name"
            required
            autoComplete="name"
            className="border-ink-300 focus:border-ink-500 mt-1 w-full rounded-lg border px-3 py-2.5 text-base outline-none"
          />
        </div>

        <div>
          <label htmlFor="wl-email" className="text-ink-700 block text-sm font-medium">
            E-mail
          </label>
          <input
            id="wl-email"
            name="email"
            type="email"
            inputMode="email"
            required
            autoComplete="email"
            className="border-ink-300 focus:border-ink-500 mt-1 w-full rounded-lg border px-3 py-2.5 text-base outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="wl-qty" className="text-ink-700 block text-sm font-medium">
              Places souhaitées
            </label>
            <select
              id="wl-qty"
              name="quantity"
              defaultValue="1"
              className="border-ink-300 mt-1 w-full rounded-lg border px-3 py-2.5 text-base"
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          {ticketTypes.length > 1 && (
            <div>
              <label htmlFor="wl-type" className="text-ink-700 block text-sm font-medium">
                Catégorie
              </label>
              <select
                id="wl-type"
                name="ticketTypeId"
                defaultValue=""
                className="border-ink-300 mt-1 w-full rounded-lg border px-3 py-2.5 text-base"
              >
                <option value="">Peu importe</option>
                {ticketTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={state.kind === 'sending'}
        className="bg-ink-900 hover:bg-ink-800 mt-4 w-full rounded-xl px-5 py-3.5 font-semibold text-white transition-colors disabled:opacity-60"
      >
        {state.kind === 'sending' ? 'Inscription…' : "M'inscrire sur la liste d'attente"}
      </button>

      <p className="text-ink-500 mt-2 text-center text-xs">
        Les places sont proposées dans l&apos;ordre d&apos;inscription.
      </p>
    </form>
  );
}
