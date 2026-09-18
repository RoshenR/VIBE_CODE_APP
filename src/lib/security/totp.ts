import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Double authentification par code temporaire (TOTP, RFC 6238).
 *
 * Implémenté directement sur `node:crypto` : l'algorithme tient en trente
 * lignes, et une dépendance de plus dans la chaîne d'approvisionnement d'un
 * module de sécurité est un risque qui se justifie mal ici.
 *
 * Compatible avec Google Authenticator, Aegis, 1Password, Bitwarden — tous
 * suivent la même norme.
 */

const DIGITS = 6;
const PERIOD_SECONDS = 30;
/**
 * Fenêtres tolérées de part et d'autre.
 *
 * Une seule : l'horloge d'un téléphone dérive de quelques secondes, refuser un
 * code affiché à cheval sur deux périodes rendrait le dispositif détestable.
 * Trois fenêtres tripleraient la surface d'attaque pour un confort marginal.
 */
const DRIFT_WINDOWS = 1;

/* -------------------------------------------------------------------------- */
/* Base32 (RFC 4648, sans remplissage) — l'encodage attendu par les applications */
/* -------------------------------------------------------------------------- */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];

  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/* -------------------------------------------------------------------------- */
/* Génération et vérification                                                 */
/* -------------------------------------------------------------------------- */

/** Secret de 20 octets : la taille recommandée pour HMAC-SHA1. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

function codeForCounter(secret: string, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest();

  // Troncature dynamique : l'octet de poids faible désigne l'offset de lecture.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function currentCode(secret: string, at: Date = new Date()): string {
  return codeForCounter(secret, Math.floor(at.getTime() / 1000 / PERIOD_SECONDS));
}

/**
 * Vérifie un code saisi.
 *
 * Comparaison à temps constant sur chaque fenêtre : comparer avec `===`
 * laisserait fuiter, par le temps de réponse, combien de chiffres sont corrects.
 */
export function verifyCode(secret: string, submitted: string, at: Date = new Date()): boolean {
  const cleaned = submitted.replace(/\D/g, '');
  if (cleaned.length !== DIGITS) return false;

  const counter = Math.floor(at.getTime() / 1000 / PERIOD_SECONDS);
  let valid = false;

  for (let drift = -DRIFT_WINDOWS; drift <= DRIFT_WINDOWS; drift++) {
    const expected = codeForCounter(secret, counter + drift);
    const a = Buffer.from(expected);
    const b = Buffer.from(cleaned);
    // Pas de sortie anticipée : on teste toutes les fenêtres quoi qu'il arrive,
    // pour que la durée ne dépende pas de celle qui a réussi.
    if (a.length === b.length && timingSafeEqual(a, b)) valid = true;
  }

  return valid;
}

/**
 * URI d'enrôlement, à encoder en QR code.
 *
 * `issuer` apparaît dans l'application du téléphone : il permet de distinguer ce
 * compte des autres.
 */
export function enrollmentUri(secret: string, accountEmail: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* -------------------------------------------------------------------------- */
/* Codes de secours                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Codes à usage unique, à imprimer ou conserver hors ligne.
 *
 * Sans eux, un téléphone perdu enferme définitivement le compte dehors. Ils sont
 * stockés **hachés** : la base ne permet pas de les rejouer.
 */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
