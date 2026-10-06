'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, CreditCard, Landmark, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/fields';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { PaymentChoice, type PaymentMethod } from '@/components/site/payment-choice';
import { StatusBadge } from '@/components/ui/badge';
import { InlineAlert } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { formatHoldDuration, formatShort } from '@/lib/dates';
import { formatCents, formatPrice } from '@/lib/money';
import { LOW_STOCK_THRESHOLD, type SalesState } from '@/lib/programme';
import type { PublicTicketType } from '@/server/catalog';
import { WaitlistForm } from './waitlist-form';

/**
 * Panneau de réservation.
 *
 * Le parcours reste celui de l'application : choisir des places, laisser ses
 * coordonnées et un moyen de paiement, puis payer sur la page suivante. Il est
 * simplement découpé en deux étapes courtes dans un panneau qui reste visible au
 * défilement sur ordinateur, avec un récapitulatif présent à chaque étape.
 *
 * Tout ce qui s'affiche vient de l'état réel du serveur : prix, tarif early et
 * sa date limite, stocks, durée de maintien. Aucun compte à rebours ni message
 * d'urgence n'est fabriqué ici.
 */

type Step = 1 | 2;
type Method = PaymentMethod;
type FieldName = 'name' | 'email' | 'phone';
type Errors = Partial<Record<FieldName, string>>;

interface Props {
  eventSlug: string;
  eventId: string;
  ticketTypes: PublicTicketType[];
  salesState: SalesState;
  opensAtIso: string | null;
  timezone: string;
  cancellationDeadlineHours: number;
  holdMinutesCard: number;
  holdHoursTransfer: number;
  waitlistOfferHours: number;
  simulated: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function BookingPanel({
  eventSlug,
  eventId,
  ticketTypes,
  salesState,
  opensAtIso,
  timezone,
  cancellationDeadlineHours,
  holdMinutesCard,
  holdHoursTransfer,
  waitlistOfferHours,
  simulated,
}: Props) {
  const router = useRouter();

  const [step, setStep] = useState<Step>(1);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<Method>('card');
  const [values, setValues] = useState({ name: '', email: '', phone: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [panelInView, setPanelInView] = useState(false);

  // Garde synchrone : `submitting` (un état) n'est mis à jour qu'au rendu suivant,
  // un double clic rapide passerait entre les deux.
  const submittingRef = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const lines = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity })),
    [quantities],
  );

  const count = lines.reduce((sum, l) => sum + l.quantity, 0);
  const total = lines.reduce((sum, line) => {
    const type = ticketTypes.find((t) => t.id === line.ticketTypeId);
    return sum + (type ? type.priceCents * line.quantity : 0);
  }, 0);

  const sellable = ticketTypes.filter((t) => t.onSale);
  const cheapest = sellable.length > 0 ? Math.min(...sellable.map((t) => t.priceCents)) : null;
  const soldOutTypes = ticketTypes.filter((t) => t.closedKind === 'soldout');

  /* Le panneau est-il à l'écran ? Sinon, la barre d'action mobile prend le relais. */
  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setPanelInView(entry.isIntersecting), {
      threshold: 0.05,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /* Au changement d'étape, le focus passe au titre : un lecteur d'écran annonce la nouvelle étape. */
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    stepHeadingRef.current?.focus();
  }, [step]);

  function goTo(next: Step): void {
    setStep(next);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    panelRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  function setQuantity(id: string, next: number): void {
    setFormError(null);
    setQuantities((prev) => ({ ...prev, [id]: next }));
  }

  function setValue(field: FieldName, value: string): void {
    setValues((prev) => ({ ...prev, [field]: value }));
    // L'erreur disparaît dès que la personne corrige : pas d'attente du prochain envoi.
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function validate(): Errors {
    const found: Errors = {};
    if (values.name.trim().length < 2) found.name = 'Indiquez votre nom (2 caractères minimum).';
    if (!EMAIL.test(values.email.trim())) {
      found.email = values.email.trim()
        ? 'Cette adresse e-mail semble incomplète.'
        : 'Indiquez votre adresse e-mail : vos billets y seront envoyés.';
    }
    if (values.phone.trim().length > 30) found.phone = 'Numéro trop long (30 caractères maximum).';
    return found;
  }

  function focusFirstError(found: Errors): void {
    const first = (['name', 'email', 'phone'] as FieldName[]).find((f) => found[f]);
    if (first) document.getElementById(`bk-${first}`)?.focus();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submittingRef.current || count === 0) return;

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstError(found);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);

    const honeypot = new FormData(event.currentTarget).get('site_web_secondaire');

    try {
      const response = await fetch('/api/hold', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventSlug,
          lines,
          name: values.name.trim(),
          email: values.email.trim(),
          phone: values.phone.trim() || null,
          site_web_secondaire: honeypot || '',
          paymentMethod: method,
          // Permet d'afficher des horaires justes aux participants à l'étranger.
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const field = result.field as FieldName | null;
        if (field && ['name', 'email', 'phone'].includes(field)) {
          const next = { [field]: result.error ?? 'Valeur invalide.' } as Errors;
          setErrors(next);
          focusFirstError(next);
        } else {
          setFormError(result.error ?? 'Une erreur est survenue. Réessayez dans un instant.');
        }

        // Plus assez de places : les compteurs affichés sont périmés. On repart de
        // l'état réel plutôt que de laisser la personne retenter sur un faux stock.
        if (response.status === 409) {
          setQuantities({});
          setStep(1);
          router.refresh();
        }

        submittingRef.current = false;
        setSubmitting(false);
        return;
      }

      // Succès : on reste en état « envoi » jusqu'à la navigation, pour qu'aucun
      // second clic ne puisse créer une deuxième réservation.
      window.location.href = result.redirectTo;
    } catch {
      setFormError('Connexion interrompue. Vérifiez votre réseau : rien n’a été débité, réessayez.');
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  /* --- Vente non ouverte : le panneau explique, sans formulaire ---------------- */

  if (salesState !== 'open') {
    return (
      <aside
        id="reserver"
        ref={panelRef}
        aria-labelledby="reserver-titre"
        className="border-rule bg-paper shadow-panel scroll-mt-24 overflow-hidden rounded-panel border lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
      >
        <PanelHeader title="Réservation" />
        <div className="space-y-5 p-5">
          {salesState === 'soldout' && (
            <>
              <InlineAlert tone="danger" title="Toutes les places sont vendues.">
                Inscrivez-vous sur la liste d&apos;attente : en cas de désistement, les places sont
                proposées automatiquement, dans l&apos;ordre d&apos;inscription.
              </InlineAlert>
              <WaitlistForm
                eventId={eventId}
                ticketTypes={ticketTypes.map((t) => ({ id: t.id, name: t.name }))}
                offerHours={waitlistOfferHours}
              />
            </>
          )}
          {salesState === 'closed' && (
            <InlineAlert tone="info" title="Les ventes sont terminées.">
              Il n&apos;est plus possible de réserver des places pour cet événement.
            </InlineAlert>
          )}
          {salesState === 'upcoming' && (
            <InlineAlert tone="info" title="La vente n'a pas encore commencé.">
              {opensAtIso
                ? `Ouverture des ventes le ${formatShort(new Date(opensAtIso), timezone)}.`
                : 'La date d’ouverture sera annoncée prochainement.'}
            </InlineAlert>
          )}
        </div>
      </aside>
    );
  }

  /* --- Vente ouverte ------------------------------------------------------------ */

  const hint = method === 'card' ? holdMinutesCard : holdHoursTransfer * 60;

  return (
    <>
      <aside
        id="reserver"
        ref={panelRef}
        aria-labelledby="reserver-titre"
        className="border-rule bg-paper shadow-lift scroll-mt-24 overflow-hidden rounded-panel border lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100svh-3rem)] lg:self-start lg:overflow-y-auto lg:sticky lg:top-6"
      >
        <PanelHeader title="Réservation" step={step} />

        <form onSubmit={submit} noValidate className="relative p-5">
          {/* Champ leurre : invisible et hors du parcours clavier. */}
          <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
            <label htmlFor="site_web_secondaire_bk">Ne pas remplir</label>
            <input id="site_web_secondaire_bk" name="site_web_secondaire" type="text" tabIndex={-1} autoComplete="off" />
          </div>

          {/* ----------------------------- ÉTAPE 1 ----------------------------- */}
          {step === 1 && (
            <div className="reveal-fade">
              <h3 ref={stepHeadingRef} tabIndex={-1} className="display text-display-sm outline-none">
                Choisissez vos places
              </h3>

              <ul className="divide-rule mt-4 divide-y">
                {ticketTypes.map((type) => (
                  <TicketRow
                    key={type.id}
                    type={type}
                    quantity={quantities[type.id] ?? 0}
                    timezone={timezone}
                    onChange={(n) => setQuantity(type.id, n)}
                  />
                ))}
              </ul>

              <Summary lines={lines} ticketTypes={ticketTypes} total={total} className="mt-5" />

              {formError && <InlineAlert tone="danger" className="mt-4">{formError}</InlineAlert>}

              <Button
                size="lg"
                block
                className="mt-5"
                disabled={count === 0}
                onClick={() => goTo(2)}
              >
                Continuer
                <ArrowRight className="size-5" aria-hidden />
              </Button>
              {count === 0 && (
                <p className="text-ink-muted mt-3 text-center text-sm">
                  Ajoutez au moins une place pour continuer.
                </p>
              )}
            </div>
          )}

          {/* ----------------------------- ÉTAPE 2 ----------------------------- */}
          {step === 2 && (
            <div className="reveal-fade">
              <button
                type="button"
                onClick={() => goTo(1)}
                className="text-ink-soft hover:text-ink -ml-1 mb-2 inline-flex min-h-11 items-center gap-1.5 rounded-control px-1 text-[0.9375rem] font-medium"
              >
                <ArrowLeft className="size-4" aria-hidden />
                Modifier mes places
              </button>

              <h3 ref={stepHeadingRef} tabIndex={-1} className="display text-display-sm outline-none">
                Vos coordonnées
              </h3>

              <div className="mt-4 space-y-4">
                <TextField
                  id="bk-name"
                  label="Nom et prénom"
                  autoComplete="name"
                  value={values.name}
                  onChange={(e) => setValue('name', e.target.value)}
                  error={errors.name}
                />
                <TextField
                  id="bk-email"
                  label="Adresse e-mail"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  hint="Vos billets y sont envoyés."
                  value={values.email}
                  onChange={(e) => setValue('email', e.target.value)}
                  error={errors.email}
                />
                <TextField
                  id="bk-phone"
                  label="Téléphone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  optional
                  value={values.phone}
                  onChange={(e) => setValue('phone', e.target.value)}
                  error={errors.phone}
                />
              </div>

              <fieldset className="mt-6">
                <legend className="mb-2 text-sm font-semibold">Moyen de paiement</legend>
                <div className="grid gap-3">
                  <PaymentChoice
                    value="card"
                    current={method}
                    onSelect={setMethod}
                    icon={CreditCard}
                    title="Carte bancaire"
                    detail={`Paiement immédiat. Vos places sont gardées ${formatHoldDuration(holdMinutesCard)}, le temps de régler.`}
                  />
                  <PaymentChoice
                    value="transfer"
                    current={method}
                    onSelect={setMethod}
                    icon={Landmark}
                    title="Virement bancaire"
                    detail={`Vos places sont gardées ${formatHoldDuration(holdHoursTransfer * 60)}, le temps que le virement arrive.`}
                  />
                </div>
              </fieldset>

              {simulated && (
                <InlineAlert tone="warning" title="Mode démonstration" className="mt-4">
                  Le paiement est simulé : aucun montant ne sera débité.
                </InlineAlert>
              )}

              <Summary lines={lines} ticketTypes={ticketTypes} total={total} className="mt-6" />

              {formError && <InlineAlert tone="danger" className="mt-4">{formError}</InlineAlert>}

              <Button type="submit" size="lg" block className="mt-5" loading={submitting}>
                {submitting ? 'Réservation en cours…' : 'Continuer vers le paiement'}
                {!submitting && <ArrowRight className="size-5" aria-hidden />}
              </Button>

              <p className="text-ink-muted mt-3 flex items-start gap-2 text-sm">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Vos places sont retenues dès la validation, pendant {formatHoldDuration(hint)}.
                  Annulation possible en ligne jusqu&apos;à {cancellationDeadlineHours} h avant le
                  début.
                </span>
              </p>
            </div>
          )}
        </form>

        {/* Hors du formulaire principal : un <form> ne s'imbrique pas dans un autre. */}
        {step === 1 && soldOutTypes.length > 0 && (
          <div className="px-5 pb-5">
            <details className="group border-rule rounded-control border">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-[0.9375rem] font-semibold [&::-webkit-details-marker]:hidden">
                <span>
                  {soldOutTypes.length === 1
                    ? `« ${soldOutTypes[0].name} » est complet — être prévenu·e`
                    : 'Une catégorie est complète — être prévenu·e'}
                </span>
                <span
                  className="text-copper-ink text-xl leading-none transition-transform duration-200 group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <div className="border-rule border-t p-4">
                <WaitlistForm
                  eventId={eventId}
                  ticketTypes={ticketTypes.map((t) => ({ id: t.id, name: t.name }))}
                  defaultTypeId={soldOutTypes[0].id}
                  offerHours={waitlistOfferHours}
                />
              </div>
            </details>
          </div>
        )}
      </aside>

      {/* Barre d'action mobile : relais du panneau quand il n'est pas à l'écran. */}
      {!panelInView && (
        <div
          className="surface-night border-night-rule shadow-lift fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
        >
          <div className="mx-auto flex max-w-xl items-center justify-between gap-4">
            <div className="min-w-0">
              {count > 0 ? (
                <>
                  <p className="text-on-night-soft text-xs">
                    {count} place{count > 1 ? 's' : ''}
                  </p>
                  <p className="display text-2xl tabular-nums">{formatCents(total)}</p>
                </>
              ) : (
                <>
                  <p className="text-on-night-soft text-xs">À partir de</p>
                  <p className="display text-2xl tabular-nums">
                    {cheapest === null ? '—' : formatPrice(cheapest)}
                  </p>
                </>
              )}
            </div>
            <Button
              tone="night"
              size="lg"
              onClick={() => {
                if (count > 0) goTo(2);
                else panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {count > 0 ? 'Continuer' : 'Choisir mes places'}
              <ArrowRight className="size-5" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Éléments du panneau                                                        */
/* -------------------------------------------------------------------------- */

function PanelHeader({ title, step }: { title: string; step?: Step }) {
  const steps = ['Billets', 'Coordonnées', 'Paiement'];
  return (
    <div className="surface-night px-5 pt-5 pb-4">
      <p className="eyebrow text-copper">{title}</p>
      <h2 id="reserver-titre" className="sr-only">
        Réserver vos places
      </h2>
      {step && (
        <ol className="mt-3 grid grid-cols-3 gap-2" aria-label="Étapes de la réservation">
          {steps.map((label, i) => {
            const n = i + 1;
            const done = n < step;
            const current = n === step;
            return (
              <li
                key={label}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'border-t-2 pt-2 text-xs leading-tight font-semibold',
                  current ? 'border-copper text-on-night' : done ? 'border-on-night-soft text-on-night-soft' : 'border-night-rule-strong text-on-night-muted',
                )}
              >
                <span className="flex items-center gap-1.5">
                  {done ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : (
                    <span className="tabular-nums">{n}</span>
                  )}
                  {label}
                </span>
                {n === 3 && <span className="text-on-night-muted block font-normal">page suivante</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function TicketRow({
  type,
  quantity,
  timezone,
  onChange,
}: {
  type: PublicTicketType;
  quantity: number;
  timezone: string;
  onChange: (next: number) => void;
}) {
  const muted = !type.onSale;
  return (
    <li className={cn('py-4', muted && 'opacity-85')}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[1.0625rem] leading-tight font-semibold">{type.name}</p>
          {type.description && <p className="text-ink-soft mt-0.5 text-sm">{type.description}</p>}

          <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="display text-[1.6rem] leading-none tabular-nums">
              {formatPrice(type.priceCents)}
            </span>
            {type.isEarly && (
              <span className="text-ink-muted text-sm tabular-nums line-through">
                {formatPrice(type.standardPriceCents)}
              </span>
            )}
          </p>

          {type.isEarly && type.earlyEndsAt && (
            <p className="text-copper-ink mt-1 text-sm font-semibold">
              Tarif early jusqu&apos;au {formatShort(type.earlyEndsAt, timezone)}
            </p>
          )}

          <div className="mt-2 empty:hidden">
            {type.onSale && type.available <= LOW_STOCK_THRESHOLD && (
              <StatusBadge tone="warning">
                Plus que {type.available} place{type.available > 1 ? 's' : ''}
              </StatusBadge>
            )}
            {type.closedKind === 'soldout' && <StatusBadge tone="danger">Complet</StatusBadge>}
            {type.closedKind === 'ended' && <StatusBadge tone="neutral">Vente terminée</StatusBadge>}
            {type.closedKind === 'notStarted' && (
              <StatusBadge tone="info">
                {type.salesStartAt
                  ? `Ouverture le ${formatShort(type.salesStartAt, timezone)}`
                  : 'Pas encore en vente'}
              </StatusBadge>
            )}
          </div>
        </div>

        {type.onSale && (
          <QuantityStepper
            label={type.name}
            value={quantity}
            max={type.maxPerOrder}
            onChange={onChange}
          />
        )}
      </div>
    </li>
  );
}

function Summary({
  lines,
  ticketTypes,
  total,
  className,
}: {
  lines: { ticketTypeId: string; quantity: number }[];
  ticketTypes: PublicTicketType[];
  total: number;
  className?: string;
}) {
  return (
    <div
      className={cn('border-rule bg-sunken/60 rounded-control border p-4', className)}
      aria-live="polite"
    >
      <p className="eyebrow text-ink-soft">Récapitulatif</p>
      {lines.length === 0 ? (
        <p className="text-ink-muted mt-2 text-sm">Aucune place sélectionnée.</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-[0.9375rem]">
          {lines.map((line) => {
            const type = ticketTypes.find((t) => t.id === line.ticketTypeId);
            if (!type) return null;
            return (
              <li key={line.ticketTypeId} className="flex justify-between gap-3">
                <span>
                  {line.quantity} × {type.name}
                  {type.isEarly && <span className="text-copper-ink"> · early</span>}
                </span>
                <span className="font-medium tabular-nums">
                  {formatCents(type.priceCents * line.quantity)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="border-rule mt-3 flex items-baseline justify-between border-t pt-3">
        <span className="font-semibold">Total</span>
        <span className="display text-display-sm tabular-nums">{formatCents(total)}</span>
      </div>
    </div>
  );
}
