'use client';

import { useRef, useState } from 'react';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/ui/fields';
import { InlineAlert } from '@/components/ui/states';

/**
 * Inscription à la liste d'attente.
 *
 * Remplace les messages Instagram. Le rang d'inscription est annoncé
 * explicitement : c'est ce que les gens demandaient en écrivant « je suis
 * combientième ? ». Et on dit la règle du jeu : les places proposées sont
 * réellement réservées pendant le délai de réponse.
 */
export function WaitlistForm({
  eventId,
  ticketTypes,
  defaultTypeId = '',
  offerHours,
}: {
  eventId: string;
  ticketTypes: { id: string; name: string }[];
  defaultTypeId?: string;
  offerHours?: number;
}) {
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'sending' } | { kind: 'done'; position: number; already: boolean }
  >({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string }>({});
  const sending = useRef(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (sending.current) return;

    const data = new FormData(e.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();

    const errors: { name?: string; email?: string } = {};
    if (name.length < 2) errors.name = 'Indiquez votre nom (2 caractères minimum).';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Adresse e-mail invalide.';
    setFieldErrors(errors);
    if (errors.name || errors.email) {
      document.getElementById(errors.name ? 'wl-name' : 'wl-email')?.focus();
      return;
    }

    sending.current = true;
    setState({ kind: 'sending' });
    setError(null);

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId,
          ticketTypeId: data.get('ticketTypeId') || null,
          name,
          email,
          site_web_secondaire: data.get('site_web_secondaire') || '',
          quantity: Number(data.get('quantity') ?? 1),
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? 'Inscription impossible. Réessayez dans un instant.');
        setState({ kind: 'idle' });
        sending.current = false;
        return;
      }

      setState({ kind: 'done', position: result.position, already: result.alreadyRegistered });
    } catch {
      setError('Connexion interrompue. Vérifiez votre réseau et réessayez.');
      setState({ kind: 'idle' });
      sending.current = false;
    }
  }

  if (state.kind === 'done') {
    return (
      <InlineAlert
        tone="success"
        title={state.already ? 'Vous étiez déjà inscrit·e.' : "Vous êtes sur la liste d'attente."}
      >
        Vous êtes en position <strong>n° {state.position}</strong>. Si une place se libère, vous
        recevez un e-mail avec un lien personnel
        {offerHours ? ` et ${offerHours} h pour confirmer` : ' et un délai pour confirmer'}. Les
        places vous sont réellement réservées pendant ce délai.
      </InlineAlert>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="relative space-y-4">
      {/* Champ leurre : invisible et hors du parcours clavier. Rempli par les robots. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="site_web_secondaire">Ne pas remplir</label>
        <input id="site_web_secondaire" name="site_web_secondaire" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 size-5 shrink-0 text-copper-ink" aria-hidden />
        <p className="text-[0.9375rem] text-ink-soft">
          Les places sont proposées dans l&apos;ordre d&apos;inscription. Vous recevez un e-mail
          dès qu&apos;une place se libère — rien n&apos;est à surveiller.
        </p>
      </div>

      <TextField
        id="wl-name"
        name="name"
        label="Nom et prénom"
        autoComplete="name"
        error={fieldErrors.name}
      />
      <TextField
        id="wl-email"
        name="email"
        type="email"
        inputMode="email"
        label="Adresse e-mail"
        autoComplete="email"
        error={fieldErrors.email}
      />

      <div className="grid grid-cols-2 gap-3">
        <SelectField id="wl-qty" name="quantity" label="Places souhaitées" defaultValue="1">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </SelectField>

        {ticketTypes.length > 1 && (
          <SelectField id="wl-type" name="ticketTypeId" label="Catégorie" defaultValue={defaultTypeId}>
            <option value="">Peu importe</option>
            {ticketTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectField>
        )}
      </div>

      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      <Button type="submit" size="lg" block loading={state.kind === 'sending'}>
        {state.kind === 'sending' ? 'Inscription…' : "M'inscrire sur la liste d'attente"}
      </Button>
    </form>
  );
}
