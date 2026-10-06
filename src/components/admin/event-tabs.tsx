'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

export interface Tab {
  href: string;
  label: string;
  /** Page d'accueil de l'événement : n'est « courante » que sur son URL exacte. */
  exact?: boolean;
}

/**
 * Onglets d'un événement.
 *
 * Défilables horizontalement sur mobile plutôt que renvoyés à la ligne : une
 * rangée qui se casse en deux lignes rend l'onglet courant difficile à repérer.
 */
export function EventTabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections de l'événement"
      className="border-rule -mx-4 mt-6 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0 print:hidden"
    >
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const current = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-12 items-center border-b-[3px] px-4 text-[0.9375rem] font-semibold whitespace-nowrap transition-colors duration-150',
                  current
                    ? 'border-copper-ink text-ink'
                    : 'text-ink-soft hover:text-ink hover:border-rule-strong border-transparent',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
