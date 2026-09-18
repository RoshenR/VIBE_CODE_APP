import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Jetons signés et datés, pour les états éphémères qui transitent par un cookie
 * ou une URL — typiquement « cet utilisateur a donné son mot de passe, il lui
 * reste à fournir son code ».
 *
 * Signés plutôt que stockés : ces états vivent quelques minutes, les persister
 * créerait une table à nettoyer et une surface de plus. La signature garantit
 * qu'ils n'ont pas été fabriqués ; l'horodatage, qu'ils n'ont pas été rejoués
 * des semaines plus tard.
 */

const SECRET = process.env.LINK_SIGNING_SECRET ?? 'dev-link-secret-a-changer-absolument';

interface Envelope<T> {
  d: T;
  /** Expiration, en secondes epoch. */
  e: number;
}

function sign(body: string, purpose: string): string {
  // Le domaine d'usage entre dans la signature : un jeton émis pour l'étape de
  // second facteur ne peut pas être présenté ailleurs, même s'il est valide.
  return createHmac('sha256', SECRET).update(`${purpose}.${body}`).digest('base64url');
}

export function issue<T>(purpose: string, data: T, ttlSeconds: number): string {
  const envelope: Envelope<T> = {
    d: data,
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(envelope)).toString('base64url');
  return `${body}.${sign(body, purpose)}`;
}

export function verify<T>(purpose: string, token: string): T | null {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expected = sign(body, purpose);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const envelope = JSON.parse(Buffer.from(body, 'base64url').toString()) as Envelope<T>;
    if (typeof envelope.e !== 'number' || envelope.e < Math.floor(Date.now() / 1000)) return null;
    return envelope.d;
  } catch {
    return null;
  }
}
