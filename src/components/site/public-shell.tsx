import Link from 'next/link';
import { ArrowUpRight, Lock } from 'lucide-react';
import { WaveLines } from '@/components/brand/wave-lines';
import { Wordmark } from '@/components/brand/wordmark';
import { isPaymentSimulated } from '@/lib/demo';
import { cn } from '@/lib/cn';

/**
 * Ossature du site public : lien d'évitement, en-tête, contenu, pied de page.
 *
 * Le contenu principal porte `id="contenu"` pour le lien d'évitement ; chaque
 * page y place son propre titre de niveau 1.
 */
export function PublicShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // Colonne pleine hauteur : sur une page courte, le pied de page reste en bas
    // de l'écran au lieu de flotter au milieu.
    <div className="flex min-h-dvh flex-col">
      <a
        href="#contenu"
        className="bg-copper text-night sr-only z-50 rounded-control px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Aller au contenu
      </a>
      <SiteHeader />
      <main id="contenu" className={cn('flex-1', className)}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

export function SiteHeader() {
  const link =
    'inline-flex h-11 items-center gap-2 rounded-control px-3 text-[0.9375rem] font-medium text-on-night-soft transition-colors duration-150 hover:bg-night-high hover:text-on-night';

  return (
    <header className="surface-night border-night-rule border-b">
      <div className="page-container flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          aria-label="Les Nuits de la Garonne — retour à l'accueil"
          className="rounded-control -mx-1 px-1"
        >
          <Wordmark size="sm" className="sm:text-[1.3rem]" />
        </Link>

        <nav aria-label="Navigation principale" className="flex items-center gap-1">
          <Link href="/#programmation" className={cn(link, 'hidden sm:inline-flex')}>
            Programmation
          </Link>
          <Link href="/admin" className={link}>
            <Lock className="size-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">Espace organisateur</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const simulated = isPaymentSimulated();

  return (
    <footer className="surface-night relative overflow-hidden">
      {/* La signature, très en retrait : elle ferme la page sans rien recouvrir. */}
      <WaveLines
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 text-copper opacity-[0.22]"
        seed={7}
        envelope="left"
        lines={8}
      />

      <div className="page-container relative grid gap-10 py-14 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="text-on-night-soft mt-4 max-w-sm text-[0.9375rem]">
            Billetterie associative des concerts et soirées de Bordeaux et alentours.
          </p>
        </div>

        <nav aria-label="Pied de page">
          <p className="eyebrow text-on-night-muted">Naviguer</p>
          <ul className="mt-4 space-y-1.5">
            <li>
              <Link
                href="/#programmation"
                className="text-on-night-soft hover:text-on-night inline-flex min-h-11 items-center transition-colors"
              >
                Programmation
              </Link>
            </li>
            <li>
              <Link
                href="/admin"
                className="text-on-night-soft hover:text-on-night inline-flex min-h-11 items-center gap-1.5 transition-colors"
              >
                Espace organisateur
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            </li>
          </ul>
        </nav>

        <div>
          <p className="eyebrow text-on-night-muted">Vos billets</p>
          <p className="text-on-night-soft mt-4 text-[0.9375rem]">
            Chaque billet porte un QR code personnel, valable pour un seul passage. Votre commande reste
            accessible depuis le lien reçu par e-mail.
          </p>
        </div>
      </div>

      {simulated && (
        <div className="border-night-rule relative border-t">
          <p className="page-container text-warning-night py-3 text-sm font-medium">
            Mode démonstration — les paiements sont simulés, aucun montant n&apos;est débité.
          </p>
        </div>
      )}
    </footer>
  );
}
