import type { Metadata } from 'next';
import { requireUser } from '@/lib/org';
import { AdminShell } from '@/components/admin/admin-shell';

// L'administration n'a rien à faire dans un moteur de recherche (le proxy envoie
// aussi l'en-tête correspondant ; on double la protection côté document).
export const metadata: Metadata = {
  title: { template: '%s — Administration', default: 'Administration' },
  robots: { index: false, follow: false },
};

/**
 * Espace de gestion : tout ce qui est derrière la connexion, hors poste d'entrée.
 *
 * `requireUser` renvoie vers la page de connexion si la session est absente ou
 * périmée. Les droits fins (par événement, par action) sont revérifiés dans
 * chaque page — ce layout ne fait que poser le cadre.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AdminShell user={user}>{children}</AdminShell>;
}
