import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Alphabet sans caractères ambigus : ni 0/O, ni 1/I/L. Une référence est lue au
 * téléphone ou recopiée depuis un e-mail ; « NDG-B8K2X » ne doit pas prêter à
 * confusion.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Référence de commande communiquée au client, ex. `NDG-B8K2X`. */
export function generateOrderReference(prefix = 'NDG'): string {
  return `${prefix}-${randomCode(5)}`;
}

/** Numéro de série d'un billet, ex. `NDG-B8K2X-03`. */
export function buildTicketSerial(orderReference: string, index: number): string {
  return `${orderReference}-${String(index).padStart(2, '0')}`;
}

/**
 * Jeton d'un lien envoyé par e-mail (gestion de commande, offre de liste
 * d'attente). Aléatoire sur 32 octets : il tient lieu d'authentification, il doit
 * être impossible à deviner.
 */
export function generateLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function newId(): string {
  return randomUUID();
}

/** Transforme un titre en identifiant d'URL lisible. */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
