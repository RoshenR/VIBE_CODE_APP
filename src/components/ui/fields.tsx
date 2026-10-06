import { useId } from 'react';
import { ChevronDown, CircleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Champs de formulaire.
 *
 * Règles communes :
 *  • un vrai <label>, toujours visible — jamais un placeholder en guise
 *    d'étiquette ;
 *  • l'aide et l'erreur sont reliées au champ (`aria-describedby`) ;
 *  • l'erreur est annoncée (`role="alert"`) et accompagnée d'un pictogramme :
 *    le rouge seul ne dit rien à une personne daltonienne ;
 *  • texte à 16 px minimum, pour éviter le zoom automatique de Safari.
 */

type Tone = 'ivory' | 'night';

interface Common {
  label: string;
  hint?: string;
  error?: string | null;
  /** Précise « (facultatif) » plutôt que d'étoiler les champs obligatoires. */
  optional?: boolean;
  tone?: Tone;
  fieldClassName?: string;
}

const control = (tone: Tone, invalid: boolean) =>
  cn(
    'block w-full rounded-control border px-3.5 text-base outline-none transition-[border-color,box-shadow] duration-150',
    'placeholder:text-ink-muted/70 disabled:cursor-not-allowed disabled:opacity-55',
    tone === 'ivory'
      ? 'bg-paper text-ink'
      : 'bg-night-raised text-on-night placeholder:text-on-night-muted',
    invalid
      ? tone === 'ivory'
        ? 'border-danger-ink shadow-[0_0_0_1px_var(--color-danger-ink)]'
        : 'border-danger-night shadow-[0_0_0_1px_var(--color-danger-night)]'
      : tone === 'ivory'
        ? 'border-rule-strong hover:border-ink focus:border-ink focus:shadow-[0_0_0_1px_var(--color-ink)]'
        : 'border-night-rule-strong hover:border-on-night-soft focus:border-on-night focus:shadow-[0_0_0_1px_var(--color-on-night)]',
  );

function Label({
  htmlFor,
  children,
  optional,
  tone,
}: {
  htmlFor: string;
  children: React.ReactNode;
  optional?: boolean;
  tone: Tone;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        'mb-1.5 flex items-baseline justify-between gap-2 text-sm font-semibold',
        tone === 'ivory' ? 'text-ink' : 'text-on-night',
      )}
    >
      <span>{children}</span>
      {optional && (
        <span
          className={cn(
            'text-xs font-normal',
            tone === 'ivory' ? 'text-ink-muted' : 'text-on-night-muted',
          )}
        >
          facultatif
        </span>
      )}
    </label>
  );
}

function Message({
  id,
  hint,
  error,
  tone,
}: {
  id: string;
  hint?: string;
  error?: string | null;
  tone: Tone;
}) {
  return (
    <>
      {hint && !error && (
        <p
          id={`${id}-hint`}
          className={cn('mt-1.5 text-sm', tone === 'ivory' ? 'text-ink-muted' : 'text-on-night-muted')}
        >
          {hint}
        </p>
      )}
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className={cn(
            'mt-1.5 flex items-start gap-1.5 text-sm font-medium',
            tone === 'ivory' ? 'text-danger-ink' : 'text-danger-night',
          )}
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}
    </>
  );
}

function describedBy(id: string, hint?: string, error?: string | null) {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

/* -------------------------------------------------------------------------- */

export function TextField({
  label,
  hint,
  error,
  optional,
  tone = 'ivory',
  fieldClassName,
  className,
  id,
  ...rest
}: Common & React.InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className={fieldClassName}>
      <Label htmlFor={fieldId} optional={optional} tone={tone}>
        {label}
      </Label>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={cn(control(tone, Boolean(error)), 'h-12', className)}
        {...rest}
      />
      <Message id={fieldId} hint={hint} error={error} tone={tone} />
    </div>
  );
}

export function TextareaField({
  label,
  hint,
  error,
  optional,
  tone = 'ivory',
  fieldClassName,
  className,
  id,
  rows = 4,
  ...rest
}: Common & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className={fieldClassName}>
      <Label htmlFor={fieldId} optional={optional} tone={tone}>
        {label}
      </Label>
      <textarea
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={cn(control(tone, Boolean(error)), 'py-3 leading-relaxed', className)}
        {...rest}
      />
      <Message id={fieldId} hint={hint} error={error} tone={tone} />
    </div>
  );
}

export function SelectField({
  label,
  hint,
  error,
  optional,
  tone = 'ivory',
  fieldClassName,
  className,
  id,
  children,
  ...rest
}: Common & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className={fieldClassName}>
      <Label htmlFor={fieldId} optional={optional} tone={tone}>
        {label}
      </Label>
      <div className="relative">
        <select
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, hint, error)}
          className={cn(control(tone, Boolean(error)), 'h-12 appearance-none pr-10', className)}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          className={cn(
            'pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2',
            tone === 'ivory' ? 'text-ink-soft' : 'text-on-night-soft',
          )}
          aria-hidden
        />
      </div>
      <Message id={fieldId} hint={hint} error={error} tone={tone} />
    </div>
  );
}

export function CheckboxField({
  label,
  hint,
  tone = 'ivory',
  className,
  id,
  ...rest
}: {
  label: string;
  hint?: string;
  tone?: Tone;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <input
        id={fieldId}
        type="checkbox"
        aria-describedby={hint ? `${fieldId}-hint` : undefined}
        className="mt-0.5 size-5 shrink-0 cursor-pointer accent-copper-ink"
        {...rest}
      />
      <div>
        <label
          htmlFor={fieldId}
          className={cn(
            'cursor-pointer text-sm font-semibold',
            tone === 'ivory' ? 'text-ink' : 'text-on-night',
          )}
        >
          {label}
        </label>
        {hint && (
          <p
            id={`${fieldId}-hint`}
            className={cn(
              'mt-0.5 text-sm',
              tone === 'ivory' ? 'text-ink-muted' : 'text-on-night-muted',
            )}
          >
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
