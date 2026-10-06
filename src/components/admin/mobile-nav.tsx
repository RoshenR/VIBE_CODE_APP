'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AdminNav, type NavItem } from './admin-nav';

/**
 * Navigation mobile : un tiroir sur l'élément natif <dialog>.
 *
 * Le <dialog> modal fournit le piégeage du focus, l'inertie du reste de la page
 * et la fermeture par Échap. Le tiroir se referme aussi à chaque changement de
 * page, sans quoi il resterait ouvert par-dessus la destination.
 */
export function MobileNav({
  items,
  organizationName,
  userName,
  roleLabel,
  signOut,
}: {
  items: NavItem[];
  organizationName: string;
  userName: string;
  roleLabel: string;
  signOut: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Nouvelle page : on referme.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="text-on-night hover:bg-night-high grid size-11 place-items-center rounded-control"
      >
        <Menu className="size-6" aria-hidden />
        <span className="sr-only">Ouvrir le menu</span>
      </button>

      <dialog
        ref={ref}
        className="drawer surface-night"
        aria-label="Menu de l'administration"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <div className="flex min-h-full flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow text-on-night-muted">Collectif</p>
              <p className="mt-1 font-semibold">{organizationName}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="hover:bg-night-high grid size-11 shrink-0 place-items-center rounded-control"
              autoFocus
            >
              <X className="size-5" aria-hidden />
              <span className="sr-only">Fermer le menu</span>
            </button>
          </div>

          <div className="mt-6">
            <AdminNav items={items} onNavigate={() => setOpen(false)} />
          </div>

          <div className="border-night-rule mt-auto border-t pt-5">
            <p className="font-semibold">{userName}</p>
            <p className="text-on-night-muted text-sm">{roleLabel}</p>
            <form action={signOut} className="mt-4">
              <Button type="submit" variant="secondary" tone="night" block>
                Se déconnecter
              </Button>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}
