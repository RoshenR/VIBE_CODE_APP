'use client';

import { useActionState, useState, useTransition } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/fields';
import { InlineAlert } from '@/components/ui/states';
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
      <Button
        className="mt-6"
        loading={starting}
        onClick={() => startTransition(async () => setEnrollment(await startEnrollmentAction()))}
      >
        {starting ? 'Préparation…' : 'Activer la double authentification'}
      </Button>
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
  if (state.done && state.recoveryCodes) return <RecoveryCodes codes={state.recoveryCodes} />;

  const qr = state.qrDataUrl ?? enrollment.qrDataUrl;
  const secret = state.secret ?? enrollment.secret;
  const token = state.enrollmentToken ?? enrollment.enrollmentToken;

  return (
    <form action={action} className="border-rule bg-canvas mt-6 rounded-panel border p-5 sm:p-6">
      <input type="hidden" name="enrollmentToken" value={token ?? ''} />

      <ol className="space-y-7">
        <Step n={1} title="Scannez ce code">
          <p className="text-ink-soft text-[0.9375rem]">
            Avec votre application d&apos;authentification (Google Authenticator, Aegis, 1Password,
            Bitwarden…).
          </p>
          {qr && (
            /* eslint-disable-next-line @next/next/no-img-element -- image locale en data URI */
            <img
              src={qr}
              alt="Code à scanner pour configurer la double authentification"
              width={200}
              height={200}
              className="mt-4 size-[200px] rounded-control bg-white p-2"
            />
          )}
        </Step>

        <Step n={2} title="Pas de caméra ? Saisissez la clé">
          <code className="bg-paper border-rule block rounded-control border px-3 py-2.5 font-mono text-sm break-all select-all">
            {secret}
          </code>
        </Step>

        <Step n={3} title="Confirmez avec le code affiché">
          <TextField
            name="code"
            label="Code à six chiffres"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            fieldClassName="max-w-[12rem]"
            className="text-center font-mono text-xl tracking-widest"
            error={state.error}
          />
        </Step>
      </ol>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="submit" loading={pending}>
          {pending ? 'Vérification…' : 'Confirmer et activer'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="bg-ink text-canvas grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <div className="mt-2">{children}</div>
      </div>
    </li>
  );
}

/**
 * Codes de secours : affichés UNE SEULE FOIS — la base n'en conserve que les
 * empreintes. Le ton est volontairement insistant : sans eux, un téléphone perdu
 * enferme le compte dehors.
 */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-6">
      <InlineAlert tone="success" title="Double authentification activée">
        Conservez ces codes de secours <strong>hors de votre téléphone</strong> : sur papier, dans un
        coffre ou dans votre gestionnaire de mots de passe. Chacun fonctionne une seule fois. Ils sont
        votre seule porte d&apos;entrée si vous perdez votre appareil, et{' '}
        <strong>ils ne seront plus jamais affichés</strong>.
      </InlineAlert>

      <ul className="mt-5 grid grid-cols-2 gap-2 font-mono text-[0.9375rem]">
        {codes.map((code) => (
          <li key={code} className="border-rule bg-paper rounded-control border px-3 py-2.5 text-center">
            {code}
          </li>
        ))}
      </ul>

      <Button
        className="mt-5"
        variant="secondary"
        onClick={() => {
          navigator.clipboard?.writeText(codes.join('\n')).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? 'Codes copiés' : 'Copier les codes'}
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function DisablePanel() {
  const [state, action, pending] = useActionState(disableTotpAction, { error: null });
  const [open, setOpen] = useState(false);

  if (state.ok) {
    return (
      <InlineAlert tone="warning" title="Double authentification désactivée" className="mt-6">
        Votre compte n&apos;est plus protégé que par son mot de passe.
      </InlineAlert>
    );
  }

  if (!open) {
    return (
      <Button className="mt-6" variant="secondary" onClick={() => setOpen(true)}>
        Désactiver
      </Button>
    );
  }

  return (
    <form action={action} className="border-warning-ink/40 bg-warning-wash mt-6 rounded-panel border p-5">
      <p className="text-warning-ink font-semibold">
        Confirmez avec votre mot de passe pour désactiver la double authentification.
      </p>
      <TextField
        name="password"
        label="Mot de passe"
        type="password"
        required
        autoComplete="current-password"
        fieldClassName="mt-4 max-w-sm"
        error={state.error}
      />
      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="submit" variant="danger" loading={pending}>
          {pending ? 'Désactivation…' : 'Désactiver la double authentification'}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
