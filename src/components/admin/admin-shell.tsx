import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Wordmark } from '@/components/brand/wordmark';
import { Button } from '@/components/ui/button';
import { InlineAlert } from '@/components/ui/states';
import { signOutAction } from '@/app/admin/actions';
import { can, ROLE_LABELS } from '@/lib/permissions';
import type { SessionUser } from '@/lib/auth';
import { AdminNav, type NavItem } from './admin-nav';
import { MobileNav } from './mobile-nav';

/**
 * Entrées de navigation, selon les droits.
 *
 * Le poste d'entrée ne voit que ce qui le concerne : la liste des événements à
 * contrôler. La navigation reflète les droits, mais ne les remplace pas — chaque
 * page et chaque action les revérifient côté serveur.
 */
export function navigationFor(user: Pick<SessionUser, 'role'>): NavItem[] {
  const items: NavItem[] = [
    {
      href: '/admin',
      label: can(user, 'chiffres.lire') ? 'Événements' : 'Événements à contrôler',
      icon: can(user, 'chiffres.lire') ? 'events' : 'scan',
      matchPrefixes: ['/admin/evenements'],
    },
  ];

  if (can(user, 'evenement.creer')) {
    items.push({ href: '/admin/evenements/nouveau', label: 'Nouvel événement', icon: 'create' });
  }

  items.push({ href: '/admin/securite', label: 'Sécurité du compte', icon: 'security' });
  return items;
}

/**
 * Cadre de l'espace de gestion : navigation latérale sur ordinateur, barre
 * compacte avec tiroir sur mobile.
 *
 * Le contexte est toujours explicite : le collectif connecté est affiché en
 * permanence. Avec plusieurs collectifs sur le même outil, on doit toujours
 * savoir pour qui l'on agit.
 */
export function AdminShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const items = navigationFor(user);
  const role = ROLE_LABELS[user.role];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a
        href="#contenu"
        className="bg-copper text-night sr-only z-50 rounded-control px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Aller au contenu
      </a>

      {/* ------------------------------------------------------- Ordinateur */}
      <aside className="surface-night border-night-rule sticky top-0 hidden h-dvh flex-col border-r lg:flex print:hidden">
        <div className="px-5 pt-6">
          <Link href="/admin" aria-label="Administration — accueil" className="inline-block rounded-control">
            <Wordmark size="sm" />
          </Link>
        </div>

        <div className="bg-night-raised border-night-rule mx-5 mt-7 rounded-control border p-3.5">
          <p className="eyebrow text-on-night-muted">Collectif</p>
          <p className="mt-1 font-semibold">{user.organizationName}</p>
        </div>

        <div className="mt-6 px-3">
          <AdminNav items={items} />
        </div>

        <div className="border-night-rule mt-auto border-t p-5">
          <p className="truncate font-semibold">{user.name}</p>
          <p className="text-on-night-muted truncate text-sm">
            {role} · {user.email}
          </p>

          <form action={signOutAction} className="mt-4">
            <Button type="submit" variant="secondary" tone="night" size="sm" block>
              Se déconnecter
            </Button>
          </form>

          <Link
            href="/"
            className="text-on-night-soft hover:text-on-night mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm transition-colors"
          >
            Voir le site public
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </aside>

      {/* ------------------------------------------------------------ Mobile */}
      <div className="min-w-0">
        <header className="surface-night border-night-rule sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b px-4 lg:hidden print:hidden">
          <div className="min-w-0">
            <Wordmark size="sm" className="text-[1rem]" />
            <p className="text-on-night-muted mt-0.5 truncate text-xs">{user.organizationName}</p>
          </div>
          <MobileNav
            items={items}
            organizationName={user.organizationName}
            userName={user.name}
            roleLabel={role}
            signOut={signOutAction}
          />
        </header>

        <main
          id="contenu"
          className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-8 lg:px-10 lg:py-10"
        >
          {/*
            Rappel persistant tant que le second facteur est inactif : un
            responsable peut annuler, rembourser et exporter la liste complète
            des participants — son mot de passe seul est une protection légère.
          */}
          {user.role === 'owner' && !user.totpEnabled && (
            <InlineAlert tone="warning" title="La double authentification n'est pas activée." className="mb-8 print:hidden">
              <Link
                href="/admin/securite"
                className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
              >
                L&apos;activer depuis la page Sécurité
              </Link>
            </InlineAlert>
          )}

          {children}
        </main>
      </div>
    </div>
  );
}
