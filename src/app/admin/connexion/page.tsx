import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { WaveLines } from '@/components/brand/wave-lines';
import { Wordmark } from '@/components/brand/wordmark';
import { getCurrentUser } from '@/lib/auth';
import { SignInForm } from './form';

export const metadata: Metadata = {
  title: 'Connexion — Administration',
  robots: { index: false, follow: false },
};

/**
 * Connexion à l'espace organisateur.
 *
 * Deux moitiés : une affiche sombre qui pose le lieu (cet espace est celui des
 * équipes, pas du public), un formulaire sobre sur ivoire. Sur téléphone, l'affiche
 * se réduit à un bandeau.
 */
export default async function SignInPage() {
  if (await getCurrentUser()) redirect('/admin');

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <section className="surface-night grain relative overflow-hidden px-6 py-8 sm:px-10 lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12">
        <WaveLines
          className="pointer-events-none absolute inset-x-0 bottom-0 h-72 text-copper opacity-[0.26]"
          seed={15}
          lines={12}
          amplitude={1.1}
        />

        <div className="relative flex items-center justify-between gap-4">
          <Link href="/" aria-label="Les Nuits de la Garonne — site public" className="inline-flex min-h-11 items-center rounded-control">
            <Wordmark size="sm" />
          </Link>
          <Link
            href="/"
            className="text-on-night-soft hover:text-on-night inline-flex min-h-11 items-center gap-2 text-sm font-medium transition-colors lg:hidden"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Site public
          </Link>
        </div>

        <div className="relative pt-14 pb-6 lg:pt-0 lg:pb-16">
          <p className="eyebrow text-copper">Équipes et collectifs</p>
          <h1 className="display text-display-xl mt-4">
            Espace
            <br />
            organisateur
          </h1>
          <p className="text-on-night-soft mt-5 max-w-md text-lg">
            Suivez vos ventes en direct, gérez vos événements et contrôlez les billets à l&apos;entrée.
          </p>
        </div>

        <Link
          href="/"
          className="text-on-night-soft hover:text-on-night relative hidden min-h-11 items-center gap-2 text-sm font-medium transition-colors lg:inline-flex"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Retour au site public
        </Link>
      </section>

      <main id="contenu" className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <h2 className="display text-display-md">Connexion</h2>
          <p className="text-ink-soft mt-2">Accès réservé aux équipes des collectifs.</p>
          <SignInForm />
        </div>
      </main>
    </div>
  );
}
