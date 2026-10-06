'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, Plus, ScanLine, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Les icônes sont désignées par un nom, pas passées en composant : un composant
 * ne traverse pas la frontière serveur → client.
 */
const ICONS = {
  events: CalendarDays,
  security: ShieldCheck,
  create: Plus,
  scan: ScanLine,
} as const;

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  /** Préfixes d'URL pour lesquels l'entrée reste « courante » (ex. toutes les pages d'un événement). */
  matchPrefixes?: string[];
}

export function AdminNav({
  items,
  onNavigate,
}: {
  items: NavItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navigation de l'administration">
      <ul className="space-y-1">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const current =
            pathname === item.href ||
            (item.matchPrefixes ?? []).some((prefix) => pathname.startsWith(prefix));

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-control border-l-2 px-3 text-[0.9375rem] font-medium transition-colors duration-150',
                  current
                    ? 'border-copper bg-night-high text-on-night'
                    : 'text-on-night-soft hover:bg-night-raised hover:text-on-night border-transparent',
                )}
              >
                <Icon className="size-[1.15rem] shrink-0" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
