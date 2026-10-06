'use client';

import { useRef, useState } from 'react';
import { ArrowRight, CreditCard, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/fields';
import { InlineAlert } from '@/components/ui/states';
import { PaymentChoice, type PaymentMethod } from '@/components/site/payment-choice';
import { formatHoldDuration } from '@/lib/dates';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function OfferForm({
  token,
  defaultName,
  defaultEmail,
  holdMinutesCard,
  holdHoursTransfer,
  simulated,
}: {
  token: string;
  defaultName: string;
  defaultEmail: string;
  holdMinutesCard: number;
  holdHoursTransfer: number;
  simulated: boolean;
}) {
  const [values, setValues] = useState({ name: defaultName, email: defaultEmail, phone: '' });
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (inFlight.current) return;

    const found: { name?: string; email?: string } = {};
    if (values.name.trim().length < 2) found.name = 'Indiquez votre nom (2 caractères minimum).';
    if (!EMAIL.test(values.email.trim())) found.email = 'Cette adresse e-mail semble incomplète.';
    setErrors(found);
    if (found.name || found.email) {
      document.getElementById(found.name ? 'of-name' : 'of-email')?.focus();
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/liste-attente/${token}/accepter`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: values.name.trim(),
          email: values.email.trim(),
          phone: values.phone.trim() || null,
          paymentMethod: method,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? 'Confirmation impossible pour le moment. Réessayez dans un instant.');
        inFlight.current = false;
        setBusy(false);
        return;
      }

      // On reste en état « envoi » jusqu'à la navigation : pas de second clic possible.
      window.location.href = result.redirectTo;
    } catch {
      setError('Connexion interrompue : rien n’a été validé. Réessayez.');
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby="offre-titre"
      className="border-rule bg-paper shadow-panel rounded-panel border p-6 sm:p-7"
    >
      <h2 id="offre-titre" className="display text-display-md">
        Confirmer ma place
      </h2>

      <div className="mt-5 space-y-4">
        <TextField
          id="of-name"
          label="Nom et prénom"
          autoComplete="name"
          value={values.name}
          error={errors.name}
          onChange={(e) => {
            setValues({ ...values, name: e.target.value });
            if (errors.name) setErrors({ ...errors, name: undefined });
          }}
        />
        <TextField
          id="of-email"
          label="Adresse e-mail"
          type="email"
          inputMode="email"
          autoComplete="email"
          hint="Vos billets y sont envoyés."
          value={values.email}
          error={errors.email}
          onChange={(e) => {
            setValues({ ...values, email: e.target.value });
            if (errors.email) setErrors({ ...errors, email: undefined });
          }}
        />
        <TextField
          id="of-phone"
          label="Téléphone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          optional
          value={values.phone}
          onChange={(e) => setValues({ ...values, phone: e.target.value })}
        />
      </div>

      <fieldset className="mt-6">
        <legend className="mb-2 text-sm font-semibold">Moyen de paiement</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <PaymentChoice
            value="card"
            current={method}
            onSelect={setMethod}
            icon={CreditCard}
            title="Carte bancaire"
            detail={`Places gardées ${formatHoldDuration(holdMinutesCard)} après validation.`}
          />
          <PaymentChoice
            value="transfer"
            current={method}
            onSelect={setMethod}
            icon={Landmark}
            title="Virement bancaire"
            detail={`Places gardées ${formatHoldDuration(holdHoursTransfer * 60)} après validation.`}
          />
        </div>
      </fieldset>

      {simulated && (
        <InlineAlert tone="warning" title="Mode démonstration" className="mt-5">
          Le paiement est simulé : aucun montant ne sera débité.
        </InlineAlert>
      )}

      {error && <InlineAlert tone="danger" className="mt-5">{error}</InlineAlert>}

      <Button type="submit" size="lg" block className="mt-6" loading={busy}>
        {busy ? 'Confirmation en cours…' : 'Confirmer et continuer vers le paiement'}
        {!busy && <ArrowRight className="size-5" aria-hidden />}
      </Button>
    </form>
  );
}
