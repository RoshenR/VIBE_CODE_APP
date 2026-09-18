import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resolvePrice, formatCents, formatPrice } from '../src/lib/money.ts';
import { buildTicketToken, verifyTicketToken, hashToken } from '../src/lib/qr.ts';
import { formatWithViewerZone, formatCountdown, isValidTimezone } from '../src/lib/dates.ts';
import { slugify, buildTicketSerial, generateOrderReference } from '../src/lib/reference.ts';

/* -------------------------------------------------------------------------- */

describe('tarification', () => {
  const base = { priceCents: 2200, earlyPriceCents: 1600, earlyEndsAt: new Date('2026-04-01') };

  test('applique le tarif early avant la date limite', () => {
    const price = resolvePrice(base, new Date('2026-03-31T23:59:00Z'));
    assert.equal(price.cents, 1600);
    assert.equal(price.label, 'early');
  });

  test('bascule seul au tarif standard une fois la date passée', () => {
    const price = resolvePrice(base, new Date('2026-04-01T00:00:01Z'));
    assert.equal(price.cents, 2200);
    assert.equal(price.label, 'standard');
  });

  test('ignore un tarif early sans date de fin', () => {
    const price = resolvePrice(
      { priceCents: 2200, earlyPriceCents: 1600, earlyEndsAt: null },
      new Date(),
    );
    assert.equal(price.cents, 2200);
  });

  test('formate les montants en euros', () => {
    // Espaces insécables : on compare sur les chiffres pour rester robuste.
    assert.match(formatCents(2200), /22/);
    assert.match(formatCents(1650), /16,50/);
    assert.equal(formatPrice(0), 'Gratuit');
  });
});

/* -------------------------------------------------------------------------- */

describe('signature des billets', () => {
  const ticketId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  test('un jeton fraîchement émis est valide', () => {
    const result = verifyTicketToken(buildTicketToken(ticketId));
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.ticketId, ticketId);
  });

  test('rejette un identifiant substitué', () => {
    const token = buildTicketToken(ticketId);
    const forged = token.replace(ticketId, '3f2504e0-4f89-41d3-9a0c-0305e82c3302');
    const result = verifyTicketToken(forged);
    assert.equal(result.ok, false);
  });

  test('rejette une signature bricolée', () => {
    const [v, id] = buildTicketToken(ticketId).split('.');
    const result = verifyTicketToken(`${v}.${id}.signature-inventee`);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'bad_signature');
  });

  test('rejette un contenu qui ne ressemble à rien', () => {
    for (const bad of ['', 'bonjour', 'v1.pas-un-uuid.xxx', 'v2.' + ticketId + '.xxx']) {
      assert.equal(verifyTicketToken(bad).ok, false);
    }
  });

  test("l'empreinte est stable et ne révèle pas le jeton", () => {
    const token = buildTicketToken(ticketId);
    const digest = hashToken(token);
    assert.equal(digest, hashToken(token));
    assert.ok(!digest.includes(ticketId));
    assert.notEqual(digest, token);
  });
});

/* -------------------------------------------------------------------------- */

describe('fuseaux horaires', () => {
  const start = new Date('2026-04-15T18:30:00Z'); // 20 h 30 à Paris

  test("n'ajoute pas de mention quand le visiteur est dans le même fuseau", () => {
    const result = formatWithViewerZone(start, 'Europe/Paris', 'Europe/Paris');
    assert.equal(result.secondary, null);
  });

  test('reste silencieux quand le décalage est identique', () => {
    // Madrid et Paris sont deux fuseaux distincts mais à la même heure.
    const result = formatWithViewerZone(start, 'Europe/Paris', 'Europe/Madrid');
    assert.equal(result.secondary, null);
  });

  test("affiche l'heure locale d'un participant à l'étranger", () => {
    const result = formatWithViewerZone(start, 'Europe/Paris', 'America/Montreal');
    assert.ok(result.secondary, 'une mention doit apparaître');
    assert.match(result.secondary!, /14:30/);
  });

  test('reconnaît les fuseaux valides', () => {
    assert.equal(isValidTimezone('Europe/Paris'), true);
    assert.equal(isValidTimezone('Pas/UnFuseau'), false);
  });
});

/* -------------------------------------------------------------------------- */

describe('compte à rebours', () => {
  test('affiche minutes et secondes sous une heure', () => {
    assert.equal(formatCountdown(9 * 60_000 + 5_000), '9 min 05 s');
  });

  test('affiche heures et minutes au-delà', () => {
    assert.equal(formatCountdown(2 * 3_600_000 + 7 * 60_000), '2 h 07 min');
  });

  test('affiche les jours pour un virement', () => {
    assert.equal(formatCountdown(72 * 3_600_000), '3 j 0 h');
  });

  test('gère un délai dépassé', () => {
    assert.equal(formatCountdown(-1), 'expirée');
  });
});

/* -------------------------------------------------------------------------- */

describe('références', () => {
  test('les slugs perdent accents et ponctuation', () => {
    assert.equal(slugify('Nuit Électrique — Rocher de Palmer'), 'nuit-electrique-rocher-de-palmer');
  });

  test('les numéros de billets sont ordonnables', () => {
    assert.equal(buildTicketSerial('NDG-B8K2X', 3), 'NDG-B8K2X-03');
    assert.equal(buildTicketSerial('NDG-B8K2X', 12), 'NDG-B8K2X-12');
  });

  test('les références évitent les caractères ambigus', () => {
    // Ni O/0 ni I/1/L : ces références sont lues au téléphone.
    for (let i = 0; i < 200; i++) {
      const reference = generateOrderReference();
      assert.match(reference, /^NDG-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
    }
  });
});
