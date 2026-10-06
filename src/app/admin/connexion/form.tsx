'use client';

import { useActionState, useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/fields';
import { InlineAlert } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { signInAction, verifyTotpAction, type SignInState } from '../actions';

const initialState: SignInState = { error: null };

/**
 * Connexion en une ou deux étapes.
 *
 * Le second facteur n'apparaît qu'APRÈS un mot de passe correct : un formulaire ne
 * doit pas révéler, avant toute authentification, quels comptes en sont équipés.
 * Les messages d'erreur sont volontairement identiques pour « compte inconnu » et
 * « mot de passe faux » (voir `signInAction`).
 */
export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, initialState);

  if (state.needsTotp) return <TotpForm initialError={state.error} />;

  return (
    <form action={action} className="mt-8 space-y-5" noValidate>
      {state.error && <InlineAlert tone="danger">{state.error}</InlineAlert>}

      <TextField
        name="email"
        label="Adresse e-mail"
        type="email"
        required
        autoComplete="username"
        inputMode="email"
        autoFocus
      />

      <PasswordField />

      <Button type="submit" size="lg" block loading={pending}>
        {pending ? 'Connexion…' : 'Se connecter'}
      </Button>
    </form>
  );
}

/**
 * Champ mot de passe avec bouton « afficher ».
 *
 * Sur téléphone, saisir un mot de passe long à l'aveugle est la première cause
 * d'échecs de connexion — et d'échecs qui comptent pour le verrouillage du compte.
 */
function PasswordField() {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        Mot de passe
      </label>
      <div className="relative">
        <input
          id={id}
          name="password"
          type={visible ? 'text' : 'password'}
          required
          autoComplete="current-password"
          className={cn(
            'border-rule-strong bg-paper text-ink hover:border-ink focus:border-ink block h-12 w-full rounded-control border pr-12 pl-3.5 text-base outline-none transition-[border-color,box-shadow] duration-150 focus:shadow-[0_0_0_1px_var(--color-ink)]',
          )}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          className="text-ink-soft hover:text-ink absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center rounded-control"
        >
          {visible ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
          <span className="sr-only">{visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}</span>
        </button>
      </div>
    </div>
  );
}

function TotpForm({ initialError }: { initialError: string | null }) {
  const [state, action, pending] = useActionState(verifyTotpAction, {
    error: initialError,
    needsTotp: true,
  } satisfies SignInState);

  return (
    <form action={action} className="mt-8 space-y-5" noValidate>
      <div>
        <h3 className="text-lg font-semibold">Code de vérification</h3>
        <p className="text-ink-soft mt-1.5 text-[0.9375rem]">
          Saisissez le code à six chiffres affiché par votre application d&apos;authentification, ou
          l&apos;un de vos codes de secours.
        </p>
      </div>

      {state.error && <InlineAlert tone="danger">{state.error}</InlineAlert>}

      <TextField
        name="code"
        label="Code"
        required
        autoFocus
        autoComplete="one-time-code"
        // `numeric` plutôt qu'un motif à six chiffres : les codes de secours
        // contiennent des lettres, un clavier numérique forcé les empêcherait.
        inputMode="numeric"
        placeholder="123456"
        className="text-center font-mono text-xl tracking-widest"
      />

      <Button type="submit" size="lg" block loading={pending}>
        {pending ? 'Vérification…' : 'Valider'}
      </Button>

      <a
        href="/admin/connexion"
        className="text-ink-soft hover:text-ink inline-flex min-h-11 w-full items-center justify-center text-sm font-medium underline underline-offset-4"
      >
        Recommencer depuis le début
      </a>
    </form>
  );
}
