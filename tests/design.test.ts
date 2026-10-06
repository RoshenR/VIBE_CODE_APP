import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  dateParts,
  formatClock,
  formatHoldDuration,
  formatShort,
  zoneCity,
  zonedToUtc,
} from '../src/lib/dates.ts';
import {
  availableFilters,
  computeSalesState,
  filterEvents,
  hashSeed,
  pickFeaturedEvent,
  splitTitle,
  type ProgrammeEvent,
  type SellableWindow,
} from '../src/lib/programme.ts';

/* -------------------------------------------------------------------------- */
/* Dates et fuseaux                                                           */
/* -------------------------------------------------------------------------- */

describe('dates affichées', () => {
  test('formatClock écrit « 20 h » et « 20 h 30 », sans « 20:00 »', () => {
    assert.equal(formatClock(new Date('2026-10-26T19:00:00Z'), 'Europe/Paris'), '20 h');
    assert.equal(formatClock(new Date('2026-10-26T19:30:00Z'), 'Europe/Paris'), '20 h 30');
    assert.equal(formatClock(new Date('2026-10-26T09:05:00Z'), 'Europe/Paris'), '10 h 05');
  });

  test('formatClock ne produit jamais « 24 h » pour minuit', () => {
    assert.equal(formatClock(new Date('2026-07-01T22:30:00Z'), 'Europe/Paris'), '0 h 30');
  });

  test('formatShort reprend le format d’heure du site', () => {
    const text = formatShort(new Date('2026-10-06T08:35:00Z'), 'Europe/Paris');
    assert.match(text, /10 h 35/);
    assert.doesNotMatch(text, /\d:\d\d/);
  });

  test('dateParts porte le jour du lieu, pas celui du visiteur', () => {
    // 00 h 30 à Paris le 27 octobre = 26 octobre à Montréal.
    const instant = new Date('2026-10-26T23:30:00Z');
    assert.equal(dateParts(instant, 'Europe/Paris').day, '27');
    assert.equal(dateParts(instant, 'America/Toronto').day, '26');
  });

  test('zoneCity donne un nom lisible', () => {
    assert.equal(zoneCity('Europe/Paris'), 'Paris');
    assert.equal(zoneCity('America/Port_of_Spain'), 'Port of Spain');
  });

  test('formatHoldDuration parle en minutes, heures puis jours', () => {
    assert.equal(formatHoldDuration(1), '1 minute');
    assert.equal(formatHoldDuration(15), '15 minutes');
    assert.equal(formatHoldDuration(360), '6 heures');
    assert.equal(formatHoldDuration(72 * 60), '3 jours');
  });
});

describe('heure murale → instant UTC', () => {
  test('heure d’été (UTC+2) et heure d’hiver (UTC+1) à Paris', () => {
    assert.equal(zonedToUtc(2026, 7, 14, 20, 30, 'Europe/Paris').toISOString(), '2026-07-14T18:30:00.000Z');
    assert.equal(zonedToUtc(2026, 12, 5, 20, 30, 'Europe/Paris').toISOString(), '2026-12-05T19:30:00.000Z');
  });

  test('un concert saisi à 20 h 30 s’affiche 20 h 30 des deux côtés du changement d’heure', () => {
    // Fin de l’heure d’été 2026 : dimanche 25 octobre à 3 h.
    for (const day of [24, 25, 26]) {
      const instant = zonedToUtc(2026, 10, day, 20, 30, 'Europe/Paris');
      assert.equal(formatClock(instant, 'Europe/Paris'), '20 h 30', `le ${day} octobre`);
    }
  });

  test('un fuseau sans heure d’été reste stable', () => {
    assert.equal(zonedToUtc(2026, 7, 1, 12, 0, 'America/Toronto').toISOString(), '2026-07-01T16:00:00.000Z');
    assert.equal(zonedToUtc(2026, 1, 1, 12, 0, 'Asia/Tokyo').toISOString(), '2026-01-01T03:00:00.000Z');
  });
});

/* -------------------------------------------------------------------------- */
/* Programmation                                                              */
/* -------------------------------------------------------------------------- */

function event(overrides: Partial<ProgrammeEvent> & { id: string }): ProgrammeEvent {
  return {
    slug: overrides.id,
    startsAt: new Date('2026-10-20T18:00:00Z'),
    isOnline: false,
    organizationName: 'Les Nuits de la Garonne',
    organizationSlug: 'nuits',
    salesState: 'open',
    totalAvailable: 50,
    ...overrides,
  };
}

describe('programmation', () => {
  test('le concert mis en avant est le prochain dont la vente est ouverte', () => {
    const list = [
      event({ id: 'a', salesState: 'soldout' }),
      event({ id: 'b', salesState: 'open' }),
      event({ id: 'c', salesState: 'open' }),
    ];
    assert.equal(pickFeaturedEvent(list)?.id, 'b');
  });

  test('à défaut de vente ouverte, on met en avant le prochain concert', () => {
    const list = [event({ id: 'a', salesState: 'closed' }), event({ id: 'b', salesState: 'upcoming' })];
    assert.equal(pickFeaturedEvent(list)?.id, 'a');
  });

  test('programmation vide : rien n’est mis en avant', () => {
    assert.equal(pickFeaturedEvent([]), null);
  });

  test('filterEvents croise format et collectif', () => {
    const list = [
      event({ id: 'a' }),
      event({ id: 'b', isOnline: true }),
      event({ id: 'c', organizationSlug: 'echo' }),
    ];
    assert.deepEqual(filterEvents(list, {}).map((e) => e.id), ['a', 'b', 'c']);
    assert.deepEqual(filterEvents(list, { format: 'online' }).map((e) => e.id), ['b']);
    assert.deepEqual(filterEvents(list, { format: 'venue' }).map((e) => e.id), ['a', 'c']);
    assert.deepEqual(filterEvents(list, { collectif: 'echo' }).map((e) => e.id), ['c']);
    assert.deepEqual(filterEvents(list, { format: 'online', collectif: 'echo' }), []);
  });

  test('les filtres ne sont proposés que s’ils changent quelque chose', () => {
    const same = [event({ id: 'a' }), event({ id: 'b' })];
    assert.equal(availableFilters(same).canFilterByFormat, false);
    assert.deepEqual(availableFilters(same).collectifs, []);

    const mixed = [event({ id: 'a' }), event({ id: 'b', isOnline: true, organizationSlug: 'echo', organizationName: 'Écho' })];
    assert.equal(availableFilters(mixed).canFilterByFormat, true);
    assert.equal(availableFilters(mixed).collectifs.length, 2);
  });

  test('splitTitle sépare « Nom — complément » et laisse le reste intact', () => {
    assert.deepEqual(splitTitle('Nuit Électrique — Rocher de Palmer'), {
      main: 'Nuit Électrique',
      sub: 'Rocher de Palmer',
    });
    assert.deepEqual(splitTitle('Jam'), { main: 'Jam', sub: null });
    assert.deepEqual(splitTitle(' — Orphelin'), { main: ' — Orphelin', sub: null });
    assert.deepEqual(splitTitle('Seul — '), { main: 'Seul — ', sub: null });
  });

  test('hashSeed est stable et répartit des slugs voisins sur plusieurs variantes', () => {
    assert.equal(hashSeed('apercu-sobre'), hashSeed('apercu-sobre'));

    const slugs = [
      'apercu-sobre',
      'apercu-ventes-terminees',
      'apercu-montreal',
      'session-acoustique-caillou',
      'apercu-complet',
      'echo-live-en-ligne',
      'apercu-categorie-complete',
      'nuit-electrique-rocher-palmer',
      'apercu-bientot',
    ];
    const variants = new Set(slugs.map((s) => hashSeed(s) % 4));
    assert.ok(variants.size >= 3, `seulement ${variants.size} variante(s) d’affiche sur ${slugs.length} événements`);
  });
});

describe('état de la vente', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const day = 86_400_000;
  const type = (o: Partial<SellableWindow> = {}): SellableWindow => ({
    salesStartAt: null,
    salesEndAt: null,
    quantityTotal: 10,
    quantityReserved: 0,
    ...o,
  });

  test('ouverte dès qu’une place est achetable', () => {
    assert.equal(computeSalesState([type()], now), 'open');
  });

  test('complète quand plus rien n’est achetable dans les catégories ouvertes', () => {
    assert.equal(computeSalesState([type({ quantityReserved: 10 })], now), 'soldout');
  });

  test('une catégorie complète n’empêche pas la vente des autres', () => {
    assert.equal(computeSalesState([type({ quantityReserved: 10 }), type()], now), 'open');
  });

  test('terminée quand toutes les fenêtres sont passées', () => {
    const ended = type({ salesEndAt: new Date(now.getTime() - day) });
    assert.equal(computeSalesState([ended, ended], now), 'closed');
  });

  test('à venir quand aucune catégorie n’a encore ouvert', () => {
    const later = type({ salesStartAt: new Date(now.getTime() + day) });
    assert.equal(computeSalesState([later], now), 'upcoming');
  });

  test('une catégorie terminée et une à venir = à venir, pas terminée', () => {
    const ended = type({ salesEndAt: new Date(now.getTime() - day) });
    const later = type({ salesStartAt: new Date(now.getTime() + day) });
    assert.equal(computeSalesState([ended, later], now), 'upcoming');
  });

  test('sans catégorie, la vente est fermée', () => {
    assert.equal(computeSalesState([], now), 'closed');
  });
});

/* -------------------------------------------------------------------------- */
/* Contrastes — mesurés sur les jetons réels de globals.css                    */
/* -------------------------------------------------------------------------- */

const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

function token(name: string): [number, number, number] {
  const match = css.match(new RegExp(`--color-${name}:\\s*#([0-9a-fA-F]{6})`));
  assert.ok(match, `jeton --color-${name} introuvable dans globals.css`);
  const hex = match[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Couleur `fg` posée à `alpha` sur `bg` (ex. `text-night/80`). */
function blend(fg: [number, number, number], bg: [number, number, number], alpha: number) {
  return fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha))) as [number, number, number];
}

const TEXT = 4.5; // WCAG AA, texte courant
const UI = 3; // WCAG AA, composants d’interface et pictogrammes

describe('contrastes (jetons de globals.css)', () => {
  const textPairs: Array<[string, string, string]> = [
    // Surfaces ivoire
    ['ink', 'canvas', 'texte principal sur fond'],
    ['ink', 'paper', 'texte principal sur carte'],
    ['ink', 'sunken', 'texte principal sur bandeau'],
    ['ink-soft', 'canvas', 'texte secondaire sur fond'],
    ['ink-soft', 'paper', 'texte secondaire sur carte'],
    ['ink-soft', 'sunken', 'texte secondaire sur bandeau'],
    ['ink-muted', 'canvas', 'métadonnées sur fond'],
    ['ink-muted', 'paper', 'métadonnées sur carte'],
    ['ink-muted', 'sunken', 'métadonnées sur bandeau'],
    ['copper-ink', 'canvas', 'cuivre sur fond'],
    ['copper-ink', 'paper', 'cuivre sur carte'],
    ['copper-ink', 'sunken', 'cuivre sur bandeau'],
    ['copper-ink', 'copper-wash', 'cuivre sur son aplat'],
    ['sage-ink', 'canvas', 'sauge sur fond'],
    ['sage-ink', 'sage-wash', 'sauge sur son aplat'],
    // États (toujours doublés d’une icône et d’un mot : ce test garde la lisibilité du mot)
    ['success-ink', 'success-wash', 'succès'],
    ['warning-ink', 'warning-wash', 'avertissement'],
    ['danger-ink', 'danger-wash', 'erreur'],
    ['info-ink', 'info-wash', 'information'],
    ['success-ink', 'paper', 'succès sur carte'],
    ['danger-ink', 'paper', 'erreur sur carte'],
    ['danger-ink', 'canvas', 'erreur sur fond'],
    // Surfaces nuit
    ['on-night', 'night', 'texte sur nuit'],
    ['on-night-soft', 'night', 'texte secondaire sur nuit'],
    ['on-night-muted', 'night', 'métadonnées sur nuit'],
    ['on-night', 'night-raised', 'texte sur carte nuit'],
    ['on-night-soft', 'night-raised', 'texte secondaire sur carte nuit'],
    ['on-night-muted', 'night-raised', 'métadonnées sur carte nuit'],
    ['on-night-muted', 'night-high', 'métadonnées sur nuit relevée'],
    ['copper', 'night', 'cuivre sur nuit'],
    ['success-night', 'night', 'succès sur nuit'],
    ['warning-night', 'night', 'avertissement sur nuit'],
    ['danger-night', 'night', 'erreur sur nuit'],
    ['info-night', 'night', 'information sur nuit'],
    ['warning-night', 'night-raised', 'avertissement sur carte nuit'],
    ['danger-night', 'night-raised', 'erreur sur carte nuit'],
    // Boutons : texte encre sur cuivre, tous états
    ['night', 'copper', 'bouton principal'],
    ['night', 'copper-hover', 'bouton principal au survol'],
    ['night', 'copper-press', 'bouton principal enfoncé'],
    ['night', 'danger-night', 'bouton danger sur nuit'],
  ];

  for (const [fg, bg, label] of textPairs) {
    test(`${label} : ${fg} sur ${bg} ≥ ${TEXT}:1`, () => {
      const value = ratio(token(fg), token(bg));
      assert.ok(value >= TEXT, `${fg} sur ${bg} : ${value.toFixed(2)}:1`);
    });
  }

  test('bouton danger : blanc sur danger-ink ≥ 4,5:1', () => {
    assert.ok(ratio([255, 255, 255], token('danger-ink')) >= TEXT);
  });

  test('affiches : texte encre à 80 % sur cuivre et sur ivoire ≥ 4,5:1', () => {
    for (const bg of ['copper', 'canvas'] as const) {
      const soft = blend(token('night'), token(bg), 0.8);
      const value = ratio(soft, token(bg));
      assert.ok(value >= TEXT, `night/80 sur ${bg} : ${value.toFixed(2)}:1`);
    }
  });

  test('bordures de contrôles ≥ 3:1 sur leur surface', () => {
    for (const bg of ['canvas', 'paper'] as const) {
      const value = ratio(token('rule-strong'), token(bg));
      assert.ok(value >= UI, `rule-strong sur ${bg} : ${value.toFixed(2)}:1`);
    }
    for (const bg of ['night', 'night-raised'] as const) {
      const value = ratio(token('night-rule-strong'), token(bg));
      assert.ok(value >= UI, `night-rule-strong sur ${bg} : ${value.toFixed(2)}:1`);
    }
  });

  test('le bouton cuivre se détache de l’ivoire par son arête, pas par son remplissage seul', () => {
    // Le remplissage cuivre sur ivoire est insuffisant (< 3:1) : c’est l’arête sombre
    // sous le bouton (#8a4b22) qui le délimite. Ce test échoue si quelqu’un la retire
    // en croyant que le remplissage suffit.
    assert.ok(ratio(token('copper'), token('canvas')) < UI);
    assert.ok(ratio(token('copper-ink'), token('canvas')) >= UI);
    assert.match(readFileSync(new URL('../src/components/ui/button.tsx', import.meta.url), 'utf8'), /#8a4b22/);
  });
});
