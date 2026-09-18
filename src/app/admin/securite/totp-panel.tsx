'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  confirmEnrollmentAction,
  disableTotpAction,
  startEnrollmentAction,
  type EnrollmentState,
} from './actions';

export function TotpPanel({ enabled }: { enabled: boolean }) {
  return enabled ? <DisablePanel /> : <EnablePanel />;
}

/* -------------------------------------------------------------------------- */

function EnablePanel() {
  const [enrollment, setEnrollment] = useState<EnrollmentState | null>(null);
  const [starting, startTransition] = useTransition();

  if (!enrollment) {
    return (
      <button
        type="button"
        disabled={starting}
        onClick={() => startTransition(async () => setEnrollment(await startEnrollmentAction()))}
        className="bg-ink-900 hover:bg-ink-800 mt-4 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {starting ? 'Préparation…' : 'Activer la double authentification'}
      </button>
    );
  }

  return <ConfirmForm enrollment={enrollment} onCancel={() => setEnrollment(null)} />;
}

function ConfirmForm({
  enrollment,
  onCancel,
}: {
  enrollment: EnrollmentState;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState(confirmEnrollmentAction, enrollment);

  // Activation terminée : les codes de secours ne seront plus jamais affichés.
  if (state.done && state.recoveryCodes) {
    return <RecoveryCodes codes={state.recoveryCodes} />;
  }

  const qr = state.qrDataUrl ?? enrollment.qrDataUrl;
  const secret = state.secret ?? enrollment.secret;
  const token = state.enrollmentToken ?? enrollment.enrollmentToken;

  return (
    <form action={action} className="border-ink-200 mt-4 rounded-xl border p-4">
      <input type="hidden" name="enrollmentToken" value={token ?? ''} />

      <ol className="text-ink-700 space-y-4 text-sm">
        <li>
          <strong>1.</strong> Scannez ce code avec votre application
          d&apos;authentification (Google Authenticator, Aegis, 1Password, Bitwarden…).
          {qr && (
            /* eslint-disable-next-line @next/next/no-img-element -- image locale en data URI */
            <img
              src={qr}
              alt="Code à scanner pour configurer la double authentification"
              width={200}
              height={200}
              className="border-ink-200 mt-3 rounded-lg border"
            />
          )}
        </li>

        <li>
          <strong>2.</strong> Si vous ne pouvez pas scanner, saisissez cette clé à la
          main :
          <code className="bg-ink-100 mt-2 block rounded-lg px-3 py-2 font-mono text-xs break-all">
            {secret}
          </code>
        </li>

        <li>
          <strong>3.</strong> Saisissez le code affiché par l&apos;application pour
          confirmer.
          <input
            name="code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            className="border-ink-300 focus:border-ink-500 mt-2 w-40 rounded-lg border px-3 py-2.5 text-center font-mono text-lg tracking-widest outline-none"
          />
        </li>
      </ol>

      {state.error && (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="bg-ink-900 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? 'Vérification…' : 'Confirmer et activer'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border-ink-300 rounded-xl border px-5 py-2.5 text-sm font-medium"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}

/**
 * Codes de secours.
 *
 * Affichés une seule fois — la base ne contient que leurs empreintes. Le ton est
 * volontairement insistant : sans eux, un téléphone perdu enferme le compte
 * dehors définitivement.
 */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
      <h3 className="font-semibold text-emerald-900">Double authentification activée</h3>
      <p className="mt-1 text-sm text-emerald-800">
        Conservez ces codes de secours <strong>hors de votre téléphone</strong> — sur
        papier, dans un coffre, ou dans votre gestionnaire de mots de passe. Chacun
        fonctionne une seule fois. Ils sont votre seule porte d&apos;entrée si vous
        perdez votre appareil, et <strong>ils ne seront plus jamais affichés</strong>.
      </p>

      <ul className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((code) => (
          <li key={code} className="rounded-lg bg-white px-3 py-2 text-center">
            {code}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(codes.join('\n')).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
        className="mt-4 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white"
      >
        {copied ? 'Copiés' : 'Copier les codes'}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function DisablePanel() {
  const [state, action, pending] = useActionState(disableTotpAction, { error: null });
  const [open, setOpen] = useState(false);

  if (state.ok) {
    return (
      <p role="status" className="mt-4 text-sm text-amber-800">
        Double authentification désactivée. Votre compte n&apos;est plus protégé que
        par son mot de passe.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-ink-300 text-ink-700 hover:bg-ink-100 mt-4 rounded-xl border px-5 py-2.5 text-sm font-medium"
      >
        Désactiver
      </button>
    );
  }

  return (
    <form action={action} className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm text-amber-900">
        Confirmez avec votre mot de passe pour désactiver la double authentification.
      </p>
      <input
        name="password"
        type="password"
        required
        autoComplete="current-password"
        className="border-ink-300 mt-3 w-full max-w-xs rounded-lg border px-3 py-2.5 text-base"
      />

      {state.error && (
        <p role="alert" className="mt-2 text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? '…' : 'Désactiver'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="border-ink-300 rounded-lg border bg-white px-4 py-2.5 text-sm"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
