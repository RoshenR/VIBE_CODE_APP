import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  auditSecrets,
  safeEquals,
  anonymizeIp,
  hashSecret,
} from '../src/lib/security/config.ts';
import {
  base32Decode,
  base32Encode,
  currentCode,
  generateRecoveryCodes,
  generateSecret,
  normalizeRecoveryCode,
  verifyCode,
} from '../src/lib/security/totp.ts';
import { issue, verify } from '../src/lib/security/signed.ts';
import { PERMISSIONS, can } from '../src/lib/permissions.ts';

/* -------------------------------------------------------------------------- */

describe('contrôle des secrets', () => {
  const bon = {
    TICKET_SIGNING_SECRET: 'Xk92mPqR7vLz3NwBcYtA5hJd8FgUeS1oQiW4rTyZ',
    LINK_SIGNING_SECRET: 'Bn41zQwErTyUiOpAsDfGhJkLxCvBnM7qWe2rTyUi',
    PAYMENT_WEBHOOK_SECRET: 'Zp83xCvBnMaSdFgHjKlQwErTyUiOp5nM2bVcXzAs',
  } as unknown as NodeJS.ProcessEnv;

  test('accepte des secrets longs et variés', () => {
    assert.equal(auditSecrets(bon).length, 0);
  });

  test('refuse les valeurs par défaut du dépôt', () => {
    const issues = auditSecrets({
      ...bon,
      TICKET_SIGNING_SECRET: 'dev-ticket-secret-a-changer-absolument',
    });
    assert.equal(issues[0]?.problem, 'valeur par défaut publique');
  });

  test('le worker démarre sans le secret des webhooks, dont il ne se sert pas', () => {
    const workerEnv = { ...bon, PAYMENT_WEBHOOK_SECRET: undefined } as unknown as NodeJS.ProcessEnv;
    const required = ['TICKET_SIGNING_SECRET', 'LINK_SIGNING_SECRET'] as const;

    assert.equal(auditSecrets(workerEnv, required).length, 0);
    // L'application, elle, le réclame toujours.
    assert.equal(auditSecrets(workerEnv).find((i) => i.variable === 'PAYMENT_WEBHOOK_SECRET')?.problem, 'manquant');
  });

  test('un secret du worker reste contrôlé : valeur publique refusée', () => {
    const issues = auditSecrets(
      { ...bon, LINK_SIGNING_SECRET: 'dev-link-secret-a-changer-absolument' } as unknown as NodeJS.ProcessEnv,
      ['TICKET_SIGNING_SECRET', 'LINK_SIGNING_SECRET'],
    );
    assert.equal(issues[0]?.problem, 'valeur par défaut publique');
  });

  test('refuse un secret absent', () => {
    const issues = auditSecrets({
      ...bon,
      LINK_SIGNING_SECRET: undefined,
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(issues[0]?.problem, 'manquant');
  });

  test('refuse un secret trop court', () => {
    const issues = auditSecrets({ ...bon, PAYMENT_WEBHOOK_SECRET: 'court' });
    assert.equal(issues[0]?.problem, 'trop court');
  });

  test("refuse un secret long mais sans variété", () => {
    const issues = auditSecrets({ ...bon, PAYMENT_WEBHOOK_SECRET: 'a'.repeat(64) });
    assert.equal(issues[0]?.problem, 'entropie insuffisante');
  });

  test('refuse deux secrets identiques', () => {
    const partage = 'Xk92mPqR7vLz3NwBcYtA5hJd8FgUeS1oQiW4rTyZ';
    const issues = auditSecrets({
      TICKET_SIGNING_SECRET: partage,
      LINK_SIGNING_SECRET: partage,
      PAYMENT_WEBHOOK_SECRET: 'Zp83xCvBnMaSdFgHjKlQwErTyUiOp5nM2bVcXzAs',
    } as unknown as NodeJS.ProcessEnv);
    assert.ok(issues.some((i) => i.problem === 'entropie insuffisante'));
  });
});

/* -------------------------------------------------------------------------- */

describe('comparaisons et anonymisation', () => {
  test('safeEquals reste exact quelles que soient les longueurs', () => {
    assert.equal(safeEquals('abc', 'abc'), true);
    assert.equal(safeEquals('abc', 'abd'), false);
    assert.equal(safeEquals('court', 'beaucoup-plus-long'), false);
    assert.equal(safeEquals('', ''), true);
  });

  test("l'empreinte d'un jeton ne laisse pas transparaître le jeton", () => {
    const token = 'jeton-de-session-tres-secret';
    const empreinte = hashSecret(token);
    assert.notEqual(empreinte, token);
    assert.ok(!empreinte.includes('secret'));
    assert.equal(empreinte, hashSecret(token));
  });

  test('les adresses IPv4 perdent leur dernier octet', () => {
    assert.equal(anonymizeIp('203.0.113.42'), '203.0.113.0');
    // Chaîne `X-Forwarded-For` : seule la première adresse compte.
    assert.equal(anonymizeIp('203.0.113.42, 70.41.3.18'), '203.0.113.0');
  });

  test('les adresses IPv6 sont réduites à leur préfixe', () => {
    assert.equal(anonymizeIp('2001:db8:85a3:8d3:1319:8a2e:370:7348'), '2001:db8:85a3::');
  });

  test('une adresse absente ne provoque pas d’erreur', () => {
    assert.equal(anonymizeIp(null), null);
    assert.equal(anonymizeIp(''), null);
  });
});

/* -------------------------------------------------------------------------- */

describe('double authentification', () => {
  test('base32 fait un aller-retour exact', () => {
    const source = Buffer.from('les nuits de la garonne');
    assert.deepEqual(base32Decode(base32Encode(source)), source);
  });

  test('un code fraîchement généré est accepté', () => {
    const secret = generateSecret();
    assert.equal(verifyCode(secret, currentCode(secret)), true);
  });

  test('un code faux est refusé', () => {
    const secret = generateSecret();
    const code = currentCode(secret);
    const faux = code === '000000' ? '111111' : '000000';
    assert.equal(verifyCode(secret, faux), false);
  });

  test('un code du secret voisin est refusé', () => {
    const code = currentCode(generateSecret());
    assert.equal(verifyCode(generateSecret(), code), false);
  });

  test('une dérive d’horloge de 30 s reste tolérée', () => {
    const secret = generateSecret();
    const maintenant = new Date();
    const avant = new Date(maintenant.getTime() - 30_000);
    assert.equal(verifyCode(secret, currentCode(secret, avant), maintenant), true);
  });

  test('un code de deux minutes est refusé', () => {
    const secret = generateSecret();
    const maintenant = new Date();
    const vieux = new Date(maintenant.getTime() - 120_000);
    assert.equal(verifyCode(secret, currentCode(secret, vieux), maintenant), false);
  });

  test('les formats invalides sont refusés sans exception', () => {
    const secret = generateSecret();
    for (const mauvais of ['', '12345', '1234567', 'abcdef', '   ']) {
      assert.equal(verifyCode(secret, mauvais), false);
    }
  });

  test('les codes de secours sont uniques et normalisables', () => {
    const codes = generateRecoveryCodes(10);
    assert.equal(new Set(codes).size, 10);
    assert.equal(normalizeRecoveryCode('a1b2c-D3E4F'), 'A1B2CD3E4F');
  });
});

/* -------------------------------------------------------------------------- */

describe('jetons signés', () => {
  test('un jeton valide se relit', () => {
    const token = issue('test', { userId: 'abc' }, 60);
    assert.deepEqual(verify<{ userId: string }>('test', token), { userId: 'abc' });
  });

  test('un jeton modifié est rejeté', () => {
    const token = issue('test', { userId: 'abc' }, 60);
    const falsifie = Buffer.from(JSON.stringify({ d: { userId: 'admin' }, e: 9e9 }))
      .toString('base64url')
      .concat('.', token.split('.').pop()!);
    assert.equal(verify('test', falsifie), null);
  });

  test("un jeton d'un autre usage est rejeté", () => {
    // Un jeton de seconde authentification ne doit pas servir à l'enrôlement.
    const token = issue('2fa', { userId: 'abc' }, 60);
    assert.equal(verify('totp-enroll', token), null);
  });

  test('un jeton expiré est rejeté', () => {
    const token = issue('test', { userId: 'abc' }, -1);
    assert.equal(verify('test', token), null);
  });

  test('un contenu absurde ne fait pas planter', () => {
    for (const mauvais of ['', 'abc', 'a.b', '....']) {
      assert.equal(verify('test', mauvais), null);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('droits par rôle', () => {
  test("le poste d'entrée ne peut que scanner", () => {
    const scanner = { role: 'scanner' as const };
    assert.equal(can(scanner, 'billets.scanner'), true);
    assert.equal(can(scanner, 'chiffres.lire'), false);
    assert.equal(can(scanner, 'participants.exporter'), false);
    assert.equal(can(scanner, 'evenement.modifier'), false);
    assert.equal(can(scanner, 'commande.annuler'), false);
  });

  test("l'équipe suit les ventes sans toucher aux réglages", () => {
    const staff = { role: 'staff' as const };
    assert.equal(can(staff, 'chiffres.lire'), true);
    assert.equal(can(staff, 'commande.annuler'), true);
    assert.equal(can(staff, 'evenement.modifier'), false);
    assert.equal(can(staff, 'evenement.publier'), false);
    assert.equal(can(staff, 'compte.gerer'), false);
  });

  test('le responsable a tous les droits', () => {
    const owner = { role: 'owner' as const };
    for (const permission of PERMISSIONS.owner) {
      assert.equal(can(owner, permission), true, permission);
    }
  });

  test('chaque rôle est inclus dans le suivant', () => {
    // Garde-fou : une permission ajoutée à `scanner` mais oubliée sur `staff`
    // créerait une hiérarchie incohérente, difficile à remarquer à la lecture.
    for (const permission of PERMISSIONS.scanner) {
      assert.ok(
        (PERMISSIONS.staff as readonly string[]).includes(permission),
        `staff devrait inclure ${permission}`,
      );
    }
    for (const permission of PERMISSIONS.staff) {
      assert.ok(
        (PERMISSIONS.owner as readonly string[]).includes(permission),
        `owner devrait inclure ${permission}`,
      );
    }
  });
});
