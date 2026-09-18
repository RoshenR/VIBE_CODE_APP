import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { signOutAction } from './actions';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <div className="bg-ink-50 min-h-dvh">
      <header className="bg-ink-900 border-ink-800 border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link href="/admin" className="text-ink-50 font-semibold tracking-tight">
            Espace organisateur
          </Link>

          {user && (
            <div className="flex flex-wrap items-center gap-4">
              {/* Le collectif est affiché en permanence : avec trois collectifs
                  sur le même outil, on doit toujours savoir où l'on est. */}
              <span className="text-ink-400 text-sm">
                {user.organizationName} · {user.name}
              </span>
              <Link
                href="/admin/securite"
                className="text-ink-300 hover:text-ink-50 text-sm transition-colors"
              >
                Sécurité
              </Link>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="text-ink-300 hover:text-ink-50 text-sm transition-colors"
                >
                  Déconnexion
                </button>
              </form>
            </div>
          )}
        </div>
      </header>

      {/*
        Rappel discret mais persistant tant que le second facteur est inactif.
        Un responsable dispose du droit d'annuler, de rembourser et d'exporter
        la liste complète des participants : son mot de passe seul est une
        protection un peu légère pour cela.
      */}
      {user && !user.totpEnabled && user.role === 'owner' && (
        <div className="border-b border-amber-200 bg-amber-50">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <span className="text-amber-900">
              La double authentification n&apos;est pas activée sur votre compte.
            </span>
            <Link
              href="/admin/securite"
              className="font-medium text-amber-900 underline underline-offset-2"
            >
              L&apos;activer maintenant
            </Link>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
