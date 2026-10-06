import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Contrôle des secrets au démarrage.
 *
 * Les valeurs par défaut de `.env.example` sont publiques : elles figurent dans
 * le dépôt. Démarrer en production avec l'une d'elles signifie que n'importe qui
 * peut forger des billets ou signer de fausses notifications de paiement.
 *
 * Ce module refuse alors le démarrage. Un service qui ne démarre pas est un
 * incident visible en dix secondes ; une billetterie qui tourne avec un secret
 * public est un incident découvert le soir du concert.
 */

/** Valeurs présentes dans `.env.example`, donc connues de tous. */
const KNOWN_DEFAULTS = new Set([
  'dev-ticket-secret-a-changer-absolument',
  'dev-link-secret-a-changer-absolument',
  'dev-webhook-secret-a-changer-absolument',
  'change-me',
  'secret',
  'changeme',
]);

const MIN_SECRET_LENGTH = 32;

export interface SecretIssue {
  variable: string;
  problem: 'manquant' | 'valeur par défaut publique' | 'trop court' | 'entropie insuffisante';
}

const REQUIRED_SECRETS = [
  'TICKET_SIGNING_SECRET',
  'LINK_SIGNING_SECRET',
  'PAYMENT_WEBHOOK_SECRET',
] as const;

export type SecretName = (typeof REQUIRED_SECRETS)[number];

/**
 * Mesure grossière de diversité : un secret de 40 caractères tous identiques
 * n'offre pas 40 caractères de résistance.
 */
function hasEnoughVariety(value: string): boolean {
  return new Set(value).size >= 10;
}

/**
 * `required` permet à un processus de ne contrôler que les secrets dont il se sert :
 * le worker n'a pas à recevoir le secret des webhooks pour démarrer.
 */
export function auditSecrets(
  env: NodeJS.ProcessEnv = process.env,
  required: readonly SecretName[] = REQUIRED_SECRETS,
): SecretIssue[] {
  const issues: SecretIssue[] = [];

  for (const variable of required) {
    const value = env[variable];

    if (!value) {
      issues.push({ variable, problem: 'manquant' });
      continue;
    }
    if (KNOWN_DEFAULTS.has(value)) {
      issues.push({ variable, problem: 'valeur par défaut publique' });
      continue;
    }
    if (value.length < MIN_SECRET_LENGTH) {
      issues.push({ variable, problem: 'trop court' });
      continue;
    }
    if (!hasEnoughVariety(value)) {
      issues.push({ variable, problem: 'entropie insuffisante' });
    }
  }

  // Deux secrets identiques : compromettre l'un compromet l'autre, alors qu'ils
  // protègent des choses différentes (billets et liens de gestion).
  const values = required.map((v) => env[v]).filter(Boolean);
  if (new Set(values).size !== values.length) {
    issues.push({
      variable: required.join(' / '),
      problem: 'entropie insuffisante',
    });
  }

  return issues;
}

let verified = false;

/**
 * À appeler avant de servir la moindre requête.
 *
 * En production, une anomalie arrête le processus. En développement, elle est
 * signalée une fois et n'empêche rien : on veut pouvoir travailler sans
 * cérémonie, mais sans oublier ce qui reste à faire.
 */
export function assertSecretsAreSafe(required: readonly SecretName[] = REQUIRED_SECRETS): void {
  if (verified) return;
  verified = true;

  const issues = auditSecrets(process.env, required);
  if (issues.length === 0) return;

  const report = issues.map((i) => `  • ${i.variable} : ${i.problem}`).join('\n');

  if (process.env.NODE_ENV === 'production') {
    console.error(
      `\nDÉMARRAGE REFUSÉ — secrets non conformes :\n${report}\n\n` +
        `Générez-en de nouveaux :\n` +
        `  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"\n`,
    );
    process.exit(1);
  }

  console.warn(
    `\n[sécurité] Secrets de développement détectés :\n${report}\n` +
      `Le démarrage sera refusé en production tant qu'ils ne seront pas changés.\n`,
  );
}

/* -------------------------------------------------------------------------- */
/* Comparaisons                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Comparaison à temps constant de deux chaînes de longueurs quelconques.
 *
 * `timingSafeEqual` exige des tampons de même taille et lève sinon — ce qui
 * révélerait déjà la longueur attendue. On compare donc les empreintes, toujours
 * de même taille.
 */
export function safeEquals(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Empreinte d'un jeton, pour un stockage qui ne permet pas de le rejouer. */
export function hashSecret(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/**
 * Tronque une adresse IP avant journalisation.
 *
 * Suffisant pour corréler des tentatives ou repérer une source abusive, sans
 * conserver une donnée qui identifie une personne. IPv4 : les trois premiers
 * octets. IPv6 : le préfixe /48.
 */
export function anonymizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const clean = ip.split(',')[0].trim();

  if (clean.includes(':')) {
    return clean.split(':').slice(0, 3).join(':') + '::';
  }
  const parts = clean.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0` : null;
}
