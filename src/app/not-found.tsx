import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { WaveLines } from '@/components/brand/wave-lines';
import { PublicShell } from '@/components/site/public-shell';
import { ButtonLink } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Page introuvable' };

/**
 * Page introuvable.
 *
 * Aussi renvoyée pour une ressource à laquelle on n'a pas droit (billet d'un
 * autre collectif, page d'administration interdite) : volontairement, on ne
 * distingue pas « n'existe pas » de « vous n'y avez pas accès ».
 */
export default function NotFound() {
  return (
    <PublicShell>
      <section className="surface-night grain relative overflow-hidden">
        <WaveLines
          className="pointer-events-none absolute inset-x-0 bottom-0 h-80 text-copper opacity-[0.22]"
          seed={4}
          lines={12}
          amplitude={1.1}
        />
        <div className="page-container relative py-20 sm:py-28 lg:min-h-[min(60svh,520px)]">
          <p className="eyebrow text-copper">Erreur 404</p>
          <h1 className="display text-display-2xl mt-4 max-w-4xl">
            Cette page n&apos;existe pas
          </h1>
          <p className="text-on-night-soft mt-6 max-w-xl text-lg">
            Le lien est peut-être périmé, ou la page a été déplacée. La programmation, elle, est
            toujours à jour.
          </p>
          <div className="mt-9">
            <ButtonLink href="/#programmation" size="lg" tone="night">
              Voir la programmation
              <ArrowRight className="size-5" aria-hidden />
            </ButtonLink>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
