import { anonymizeIp } from './config';

/**
 * Inspection des requêtes entrantes : origine, adresse cliente, taille.
 */

/* -------------------------------------------------------------------------- */
/* Origine (protection CSRF)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Vérifie que la requête vient bien de notre propre site.
 *
 * Le cookie de session est en `SameSite=Lax`, ce qui bloque déjà la majorité des
 * attaques CSRF — mais `Lax` laisse passer les navigations de haut niveau, et
 * certains navigateurs anciens l'appliquent mal. Surtout, plusieurs de nos
 * routes ne s'appuient pas du tout sur le cookie : l'annulation d'une commande
 * s'authentifie par un jeton dans l'URL. Une page tierce pourrait donc, sans ce
 * contrôle, faire annuler une commande dont elle a vu le lien passer.
 *
 * On exige `Origin` ; à défaut on accepte `Referer`, dont on ne garde que
 * l'origine. Une requête sans ni l'un ni l'autre est rejetée pour toute méthode
 * modifiant l'état.
 */
export function isSameOrigin(request: Request): boolean {
  const expected = allowedOrigins();

  const origin = request.headers.get('origin');
  if (origin) return expected.has(normalizeOrigin(origin));

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return expected.has(normalizeOrigin(new URL(referer).origin));
    } catch {
      return false;
    }
  }

  return false;
}

function normalizeOrigin(value: string): string {
  return value.replace(/\/+$/, '').toLowerCase();
}

/**
 * Origines acceptées : celle configurée, plus celle de la requête en
 * développement (l'adresse d'accès varie — localhost, 127.0.0.1, IP du réseau
 * local quand on teste depuis un téléphone).
 */
function allowedOrigins(): Set<string> {
  const configured = process.env.APP_URL ?? 'http://localhost:3000';
  const origins = new Set([normalizeOrigin(configured)]);

  if (process.env.NODE_ENV !== 'production') {
    for (const dev of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
      origins.add(dev);
    }
  }

  const extra = process.env.ADDITIONAL_ORIGINS;
  if (extra) {
    for (const o of extra.split(',')) {
      const trimmed = o.trim();
      if (trimmed) origins.add(normalizeOrigin(trimmed));
    }
  }

  return origins;
}

export function forbiddenOrigin(): Response {
  return new Response(JSON.stringify({ error: 'Origine de la requête non autorisée.' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });
}

/* -------------------------------------------------------------------------- */
/* Adresse cliente                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Adresse de l'appelant, tronquée pour la journalisation et les compteurs.
 *
 * `X-Forwarded-For` n'est lu que si `TRUST_PROXY` est explicitement activé.
 * Sinon, n'importe qui pourrait envoyer l'en-tête de son choix et contourner
 * toutes les limites de débit en changeant d'adresse déclarée à chaque requête.
 */
export function clientIp(request: Request): string {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) return anonymizeIp(forwarded) ?? 'inconnue';

    const real = request.headers.get('x-real-ip');
    if (real) return anonymizeIp(real) ?? 'inconnue';
  }

  // Sans proxy de confiance, on se rabat sur une valeur fournie par l'hôte si
  // elle existe. Une valeur constante reste préférable à une valeur falsifiable :
  // la limite devient globale au lieu d'être contournable.
  const direct = (request as Request & { ip?: string }).ip;
  return anonymizeIp(direct) ?? 'directe';
}

export function userAgent(request: Request): string | null {
  const value = request.headers.get('user-agent');
  return value ? value.slice(0, 250) : null;
}

/* -------------------------------------------------------------------------- */
/* Corps de requête                                                           */
/* -------------------------------------------------------------------------- */

export class PayloadTooLargeError extends Error {
  constructor() {
    super('Corps de requête trop volumineux.');
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Lit le corps en refusant au-delà d'une taille donnée.
 *
 * Sans plafond, un client peut occuper mémoire et connexion avec un JSON de
 * plusieurs centaines de mégaoctets — une manière discrète et peu coûteuse de
 * mettre le service à genoux.
 */
export async function readJsonBody<T = unknown>(
  request: Request,
  maxBytes = 64 * 1024,
): Promise<T> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) throw new PayloadTooLargeError();

  const text = await request.text();
  // L'en-tête peut mentir ou manquer : on revérifie sur le contenu réel.
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new PayloadTooLargeError();

  return JSON.parse(text) as T;
}

export function payloadTooLarge(): Response {
  return new Response(JSON.stringify({ error: 'Requête trop volumineuse.' }), {
    status: 413,
    headers: { 'content-type': 'application/json' },
  });
}

/* -------------------------------------------------------------------------- */
/* Pièges à robots                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Champ leurre des formulaires publics.
 *
 * Invisible et sans étiquette pour une personne, il est rempli par la plupart
 * des robots de remplissage automatique. Ce n'est pas une barrière sérieuse
 * contre un attaquant motivé — c'est un filtre quasi gratuit contre le bruit de
 * fond, qui représente l'essentiel des soumissions parasites.
 */
export const HONEYPOT_FIELD = 'site_web_secondaire';

export function looksAutomated(payload: Record<string, unknown>): boolean {
  const value = payload[HONEYPOT_FIELD];
  return typeof value === 'string' && value.trim().length > 0;
}
