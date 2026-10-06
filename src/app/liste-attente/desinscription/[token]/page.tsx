import type { Metadata } from 'next';
import { PublicShell } from '@/components/site/public-shell';
import { UnsubscribeButton } from './button';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "Quitter la liste d'attente",
  robots: { index: false, follow: false },
};

/**
 * Désinscription de la liste d'attente.
 *
 * Volontairement en DEUX TEMPS : la page affiche une confirmation, elle ne
 * désinscrit pas à l'ouverture. Les clients de messagerie et les antivirus
 * visitent les liens des e-mails pour les analyser — une désinscription au
 * chargement partirait donc toute seule, sans que personne n'ait rien demandé.
 */
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <PublicShell>
      <div className="page-container py-14 sm:py-20">
        <div className="border-rule bg-paper shadow-panel mx-auto max-w-xl rounded-panel border p-7 sm:p-9">
          <p className="eyebrow text-copper-ink">Liste d&apos;attente</p>
          <h1 className="display text-display-lg mt-2">Quitter la liste d&apos;attente</h1>
          <p className="text-ink-soft mt-4 text-[1.0625rem]">
            Vous ne recevrez plus d&apos;offre si une place se libère pour cet événement. Vous
            pourrez vous réinscrire à tout moment depuis la page de l&apos;événement.
          </p>
          <UnsubscribeButton token={token} />
        </div>
      </div>
    </PublicShell>
  );
}
