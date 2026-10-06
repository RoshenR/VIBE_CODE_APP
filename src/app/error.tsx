'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import { WaveLines } from '@/components/brand/wave-lines';
import { Button, buttonClasses } from '@/components/ui/button';

/**
 * Erreur inattendue.
 *
 * Volontairement autonome (sans l'ossature du site) : si la cause de l'erreur est
 * justement dans l'en-tête ou le pied de page, afficher ceux-ci referait planter
 * la page d'erreur.
 *
 * Le détail technique n'est jamais montré à l'écran — il renseigne autant
 * l'utilisateur que quelqu'un qui cherche une faille. L'identifiant (`digest`)
 * permet en revanche à l'équipe de retrouver l'incident dans les journaux.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="surface-night grain relative grid min-h-dvh place-items-center overflow-hidden px-6 py-16">
      <WaveLines
        className="pointer-events-none absolute inset-x-0 bottom-0 h-80 text-copper opacity-[0.2]"
        seed={8}
        lines={11}
        amplitude={1.1}
      />
      <div className="relative max-w-2xl">
        <p className="eyebrow text-copper">Un incident est survenu</p>
        <h1 className="display text-display-xl mt-4">Ça n&apos;a pas marché</h1>
        <p className="text-on-night-soft mt-5 text-lg">
          La page n&apos;a pas pu s&apos;afficher. Rien n&apos;a été débité ni modifié par cet
          incident. Réessayez dans un instant.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button tone="night" size="lg" onClick={reset}>
            <RotateCcw className="size-5" aria-hidden />
            Réessayer
          </Button>
          <Link href="/" className={buttonClasses({ variant: 'secondary', tone: 'night', size: 'lg' })}>
            Retour à l&apos;accueil
          </Link>
        </div>

        {error.digest && (
          <p className="text-on-night-muted mt-8 text-sm">
            Référence de l&apos;incident : <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
    </main>
  );
}
