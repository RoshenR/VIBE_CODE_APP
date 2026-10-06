import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { signOutAction } from '@/app/admin/actions';
import { requireUser } from '@/lib/org';
import { can, ROLE_LABELS } from '@/lib/permissions';

export const metadata: Metadata = {
  title: { template: '%s — Contrôle', default: "Contrôle à l'entrée" },
  robots: { index: false, follow: false },
};

/**
 * Cadre du poste d'entrée.
 *
 * Volontairement dépouillé : pas de navigation latérale, pas de menu. Cet écran
 * s'utilise debout, d'une main, souvent dans le noir — chaque élément en trop est
 * une chance de toucher le mauvais bouton. Fond sombre pour ne pas éblouir.
 */
export default async function ScanLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // Un responsable revient à l'événement ; le poste d'entrée, à sa liste.
  const backHref = '/admin';
  const showsFigures = can(user, 'chiffres.lire');

  return (
    <div className="surface-night min-h-dvh">
      <a
        href="#contenu"
        className="bg-copper text-night sr-only z-50 rounded-control px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Aller au contenu
      </a>

      <header className="border-night-rule border-b">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-3 px-4">
          <Link
            href={backHref}
            className="text-on-night-soft hover:text-on-night -ml-2 inline-flex min-h-11 items-center gap-2 rounded-control px-2 text-sm font-medium transition-colors"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {showsFigures ? 'Événements' : 'Mes soirées'}
          </Link>

          <div className="flex items-center gap-3">
            <p className="text-on-night-muted hidden text-xs sm:block">
              {user.organizationName} · {ROLE_LABELS[user.role]}
            </p>
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" tone="night" size="sm">
                Quitter
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main id="contenu" className="mx-auto max-w-2xl px-4 py-6 pb-16">
        {children}
      </main>
    </div>
  );
}
