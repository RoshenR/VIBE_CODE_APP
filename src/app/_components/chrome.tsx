import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="border-b border-ink-200 bg-ink-900">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-ink-50 font-semibold tracking-tight">
          Les Nuits de la Garonne
        </Link>
        <Link
          href="/admin"
          className="text-ink-400 hover:text-ink-100 text-sm transition-colors"
        >
          Espace organisateur
        </Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-ink-200 mt-16 border-t">
      <div className="text-ink-500 mx-auto max-w-3xl px-4 py-8 text-sm">
        Billetterie associative — Bordeaux.
      </div>
    </footer>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'warn' | 'danger' | 'ok';
  children: React.ReactNode;
}) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-600',
    ok: 'bg-emerald-50 text-emerald-700',
    warn: 'bg-amber-50 text-amber-800',
    danger: 'bg-rose-50 text-rose-700',
  } as const;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Message d'erreur. `role="alert"` pour que les lecteurs d'écran l'annoncent
 * sans avoir à replacer le focus.
 */
export function Alert({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'warn' | 'info';
  children: React.ReactNode;
}) {
  const tones = {
    danger: 'border-rose-200 bg-rose-50 text-rose-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-ink-200 bg-ink-100 text-ink-700',
  } as const;

  return (
    <div role="alert" className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}
