import { NextResponse, type NextRequest } from 'next/server';

/**
 * En-têtes de sécurité appliqués à toutes les réponses.
 *
 * Fichier `proxy.ts` : c'est la convention Next.js 16, qui remplace
 * `middleware.ts` (déprécié).
 *
 * Ce fichier est la seule défense qui protège même contre nos propres erreurs
 * futures : si une faille d'injection apparaît un jour dans une page, la
 * politique de contenu limite ce qu'un attaquant peut en faire.
 */

export const config = {
  // Les ressources statiques n'ont pas besoin de ce traitement.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js).*)'],
};

export default function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isProduction = process.env.NODE_ENV === 'production';

  /*
   * Politique de contenu.
   *
   * `script-src` est strict : uniquement les scripts portant le nonce du jour.
   * Next.js reconnaît le nonce présent dans l'en-tête de la requête et l'appose
   * lui-même sur les siens.
   *
   * `'unsafe-eval'` est toléré hors production : le rafraîchissement à chaud de
   * Next l'exige. Il disparaît en production, là où il compte.
   *
   * `style-src-attr 'unsafe-inline'` est nécessaire et sans danger notable : les
   * barres de progression du tableau de bord utilisent `style={{ width }}`.
   * Autoriser les *attributs* de style ne permet pas d'exécuter du code.
   */
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? '' : " 'unsafe-eval'"}`,
    `style-src 'self'`,
    `style-src-attr 'unsafe-inline'`,
    // `data:` couvre les QR intégrés, `blob:` les flux caméra du poste d'entrée.
    `img-src 'self' data: blob:`,
    `media-src 'self' blob:`,
    `font-src 'self'`,
    // Aucun appel sortant : cette application ne parle qu'à elle-même.
    `connect-src 'self'`,
    `form-action 'self'`,
    // Personne ne doit pouvoir encadrer nos pages : protection contre le
    // détournement de clic, notamment sur les boutons d'annulation.
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    ...(isProduction ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('content-security-policy', csp);
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('x-frame-options', 'DENY');

  /*
   * `no-referrer` plutôt que la valeur par défaut : les liens de gestion de
   * commande et les offres de liste d'attente portent leur jeton dans l'URL.
   * Sans cette ligne, cliquer sur un lien sortant depuis ces pages transmettrait
   * le jeton au site visité — c'est-à-dire l'accès aux billets.
   */
  response.headers.set('referrer-policy', 'no-referrer');

  response.headers.set(
    'permissions-policy',
    // La caméra reste autorisée pour nous seuls : le poste d'entrée en dépend.
    'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );
  response.headers.set('cross-origin-opener-policy', 'same-origin');
  response.headers.set('cross-origin-resource-policy', 'same-origin');
  response.headers.set('x-dns-prefetch-control', 'off');

  if (isProduction) {
    response.headers.set(
      'strict-transport-security',
      'max-age=31536000; includeSubDomains; preload',
    );
  }

  const path = request.nextUrl.pathname;

  // L'espace organisateur et les pages porteuses d'un jeton ne doivent jamais
  // être indexés ni mis en cache par un intermédiaire.
  if (
    path.startsWith('/admin') ||
    path.startsWith('/commande/') ||
    path.startsWith('/liste-attente/') ||
    path.startsWith('/api/')
  ) {
    response.headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
    response.headers.set('cache-control', 'no-store, max-age=0, must-revalidate');
  }

  return response;
}
