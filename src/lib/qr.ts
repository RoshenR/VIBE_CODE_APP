import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.TICKET_SIGNING_SECRET ?? 'dev-ticket-secret-a-changer-absolument';

/**
 * Format du contenu d'un QR code de billet : `v1.<uuid>.<signature>`.
 *
 * La signature empêche de fabriquer un billet. Elle n'empêche pas de photographier
 * ou de transférer un billet valide — c'est le scan qui s'en charge : la première
 * validation gagne, toutes les suivantes sont refusées (voir src/server/checkin.ts).
 */
const VERSION = 'v1';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('base64url');
}

export function buildTicketToken(ticketId: string): string {
  const body = `${VERSION}.${ticketId}`;
  return `${body}.${sign(body)}`;
}

export type TokenVerification =
  | { ok: true; ticketId: string }
  | { ok: false; reason: 'malformed' | 'bad_signature' };

export function verifyTicketToken(token: string): TokenVerification {
  const parts = token.trim().split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };

  const [version, ticketId, signature] = parts;
  if (version !== VERSION) return { ok: false, reason: 'malformed' };
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) return { ok: false, reason: 'malformed' };

  const expected = sign(`${version}.${ticketId}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // La comparaison à temps constant évite de fuiter la signature attendue.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true, ticketId };
}

/**
 * Empreinte d'un jeton, utilisée dans le manifeste hors ligne du contrôle d'accès.
 *
 * Le manifeste téléchargé sur les téléphones de l'équipe ne contient que ces
 * empreintes, jamais les jetons eux-mêmes : un téléphone perdu ou volé ne permet
 * donc pas de fabriquer des billets valides.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('base64url');
}
