import { SiteFooter, SiteHeader } from '@/app/_components/chrome';
import { UnsubscribeButton } from './button';

export const dynamic = 'force-dynamic';
export const metadata = { title: "Désinscription de la liste d'attente" };

/**
 * Désinscription de la liste d'attente.
 *
 * Volontairement en **deux temps** : la page affiche une confirmation, elle ne
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
    <>
      <SiteHeader />
      <main className="mx-auto max-w-lg px-4 py-10">
        <h1 className="text-ink-900 text-xl font-semibold tracking-tight">
          Quitter la liste d&apos;attente
        </h1>
        <p className="text-ink-600 mt-2 text-sm">
          Vous ne recevrez plus d&apos;offre si une place se libère pour cet
          événement. Vous pourrez vous réinscrire à tout moment depuis la page de
          l&apos;événement.
        </p>

        <UnsubscribeButton token={token} />
      </main>
      <SiteFooter />
    </>
  );
}
