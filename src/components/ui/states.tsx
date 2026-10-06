import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Surface } from './badge';

/* -------------------------------------------------------------------------- */
/* Message en ligne                                                           */
/* -------------------------------------------------------------------------- */

type AlertTone = 'success' | 'warning' | 'danger' | 'info';

const ICONS: Record<AlertTone, LucideIcon> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  info: Info,
};

const ivory: Record<AlertTone, string> = {
  success: 'border-success-ink/35 bg-success-wash text-success-ink',
  warning: 'border-warning-ink/35 bg-warning-wash text-warning-ink',
  danger: 'border-danger-ink/35 bg-danger-wash text-danger-ink',
  info: 'border-info-ink/35 bg-info-wash text-info-ink',
};

const night: Record<AlertTone, string> = {
  success: 'border-success-night/45 bg-success-night/10 text-success-night',
  warning: 'border-warning-night/45 bg-warning-night/10 text-warning-night',
  danger: 'border-danger-night/45 bg-danger-night/10 text-danger-night',
  info: 'border-info-night/45 bg-info-night/10 text-info-night',
};

/**
 * Message de retour : toujours un pictogramme, un titre court facultatif et un
 * texte. `role="alert"` pour les erreurs (annoncées immédiatement), `status`
 * pour le reste (annoncé poliment).
 */
export function InlineAlert({
  tone = 'info',
  surface = 'ivory',
  title,
  children,
  className,
  id,
}: {
  tone?: AlertTone;
  surface?: Surface;
  title?: string;
  children?: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const Icon = ICONS[tone];
  return (
    <div
      id={id}
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-panel border px-4 py-3.5 text-[0.9375rem] leading-snug',
        surface === 'ivory' ? ivory[tone] : night[tone],
        className,
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* État vide                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * État vide : dit ce qui manque, pourquoi, et ce qu'on peut faire ensuite.
 * Un tableau vide sans explication ressemble à une panne.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  surface = 'ivory',
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  surface?: Surface;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-panel border border-dashed px-6 py-12 text-center',
        surface === 'ivory' ? 'border-rule-strong/70' : 'border-night-rule-strong',
        className,
      )}
    >
      <span
        className={cn(
          'mx-auto grid size-12 place-items-center rounded-control',
          surface === 'ivory' ? 'bg-sunken text-ink-soft' : 'bg-night-high text-on-night-soft',
        )}
      >
        <Icon className="size-6" aria-hidden />
      </span>
      <h3
        className={cn(
          'mt-4 text-lg font-semibold',
          surface === 'ivory' ? 'text-ink' : 'text-on-night',
        )}
      >
        {title}
      </h3>
      {children && (
        <div
          className={cn(
            'measure mx-auto mt-1.5 text-[0.9375rem]',
            surface === 'ivory' ? 'text-ink-soft' : 'text-on-night-soft',
          )}
        >
          {children}
        </div>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
