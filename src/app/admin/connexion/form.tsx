'use client';

import { useActionState } from 'react';
import { signInAction, verifyTotpAction, type SignInState } from '../actions';

const initialState: SignInState = { error: null };

/**
 * Connexion en une ou deux étapes.
 *
 * Le second facteur n'apparaît qu'après un mot de passe correct : il ne faut pas
 * qu'un formulaire révèle, avant toute authentification, quels comptes en sont
 * équipés.
 */
export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, initialState);

  if (state.needsTotp) return <TotpForm initialError={state.error} />;

  return (
    <form
      action={action}
      className="border-ink-200 mt-6 space-y-4 rounded-2xl border bg-white p-5"
    >
      <div>
        <label htmlFor="email" className="text-ink-700 block text-sm font-medium">
          Adresse e-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="border-ink-300 focus:border-ink-500 mt-1 w-full rounded-lg border px-3 py-2.5 text-base outline-none"
        />
      </div>

      <div>
        <label htmlFor="password" className="text-ink-700 block text-sm font-medium">
          Mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="border-ink-300 focus:border-ink-500 mt-1 w-full rounded-lg border px-3 py-2.5 text-base outline-none"
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-ink-900 hover:bg-ink-800 w-full rounded-xl px-5 py-3 font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  );
}

function TotpForm({ initialError }: { initialError: string | null }) {
  const [state, action, pending] = useActionState(verifyTotpAction, {
    error: initialError,
    needsTotp: true,
  } satisfies SignInState);

  return (
    <form
      action={action}
      className="border-ink-200 mt-6 space-y-4 rounded-2xl border bg-white p-5"
    >
      <div>
        <h2 className="text-ink-900 font-medium">Code de vérification</h2>
        <p className="text-ink-500 mt-1 text-sm">
          Saisissez le code à six chiffres affiché par votre application
          d&apos;authentification, ou l&apos;un de vos codes de secours.
        </p>
      </div>

      <div>
        <label htmlFor="code" className="text-ink-700 block text-sm font-medium">
          Code
        </label>
        <input
          id="code"
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode="numeric"
          // `numeric` plutôt que `\d{6}` : les codes de secours contiennent des
          // lettres, et un clavier numérique forcé empêcherait de les saisir.
          placeholder="123456"
          className="border-ink-300 focus:border-ink-500 mt-1 w-full rounded-lg border px-3 py-2.5 text-center font-mono text-xl tracking-widest outline-none"
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-ink-900 hover:bg-ink-800 w-full rounded-xl px-5 py-3 font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Vérification…' : 'Valider'}
      </button>

      <a href="/admin/connexion" className="text-ink-500 block text-center text-sm underline">
        Recommencer
      </a>
    </form>
  );
}
