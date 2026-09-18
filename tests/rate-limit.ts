import { loadEnv } from '../src/lib/env';
loadEnv();

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../src/db';
import { consume, consumeAll, RULES } from '../src/lib/security/rate-limit';
import { checkLock, clearFailures, recordFailure } from '../src/lib/security/lockout';

/**
 * Épreuve des défenses contre l'abus.
 *
 * Tourne contre un vrai PostgreSQL : ce qui est vérifié ici, c'est justement
 * l'atomicité des compteurs sous concurrence — exactement comme pour le stock de
 * places. Un compteur simulé en mémoire prouverait seulement que la simulation
 * est d'accord avec nous.
 *
 *   npm run test:rate-limit
 */

let failures = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  console.log("Épreuve des défenses contre l'abus\n" + '='.repeat(44));

  /* --- Limitation de débit --------------------------------------------- */

  console.log('\nLimitation de débit — séquentielle');

  const cible = `test-${randomUUID()}`;
  const limite = RULES.login.limit;

  const resultats = [];
  for (let i = 0; i < limite + 4; i++) resultats.push(await consume('login', cible));

  const acceptees = resultats.filter((r) => r.allowed).length;
  check(
    `exactement ${limite} tentatives acceptées sur ${limite + 4}`,
    acceptees === limite,
    `${acceptees} acceptées`,
  );
  check(
    'un délai de réessai est communiqué au refus',
    resultats.at(-1)!.retryAfter > 0,
    String(resultats.at(-1)!.retryAfter),
  );
  check('le compteur restant atteint bien zéro', resultats.at(-1)!.remaining === 0);

  /* --- Concurrence ------------------------------------------------------ */

  console.log('\nLimitation de débit — 60 requêtes simultanées');

  const cibleConcurrente = `test-${randomUUID()}`;
  const paralleles = await Promise.all(
    Array.from({ length: 60 }, () => consume('hold', cibleConcurrente)),
  );
  const passees = paralleles.filter((r) => r.allowed).length;

  // Le point critique : sans incrément atomique, plusieurs requêtes liraient le
  // même compteur et passeraient ensemble — exactement le défaut qui a produit
  // la survente sur les places.
  check(
    `exactement ${RULES.hold.limit} requêtes simultanées acceptées`,
    passees === RULES.hold.limit,
    `${passees} passées`,
  );

  /* --- Compteurs indépendants ------------------------------------------- */

  console.log('\nCloisonnement des compteurs');

  const a = `test-${randomUUID()}`;
  const b = `test-${randomUUID()}`;
  for (let i = 0; i < RULES.waitlist.limit; i++) await consume('waitlist', a);

  const saturé = await consume('waitlist', a);
  const voisin = await consume('waitlist', b);
  check('une cible saturée est bloquée', !saturé.allowed);
  check("une autre cible n'est pas affectée", voisin.allowed);

  const autreRegle = await consume('cancel', a);
  check('une autre règle sur la même cible reste libre', autreRegle.allowed);

  /* --- Combinaison de compteurs ----------------------------------------- */

  console.log('\nCombinaison IP + e-mail');

  const ip = `test-ip-${randomUUID()}`;
  const email = `test-mail-${randomUUID()}`;
  for (let i = 0; i < RULES.hold.limit; i++) await consume('hold', `ip:${ip}`);

  const combine = await consumeAll([
    { rule: 'hold', identifier: `ip:${ip}` },
    { rule: 'hold', identifier: `email:${email}` },
  ]);
  // Une adresse e-mail neuve derrière une IP saturée doit rester bloquée :
  // sinon, changer d'adresse suffirait à contourner la limite.
  check("le compteur le plus contraignant l'emporte", !combine.allowed);

  /* --- Verrouillage de compte ------------------------------------------- */

  console.log('\nVerrouillage après échecs répétés');

  const compte = `test-compte-${randomUUID()}`;
  let etat = await checkLock(compte);
  check('un compte inconnu n’est pas verrouillé', !etat.locked);

  // Cinq échecs tolérés, le sixième verrouille.
  for (let i = 0; i < 5; i++) etat = await recordFailure(compte);
  check('cinq échecs ne verrouillent pas encore', !etat.locked, `${etat.failures} échecs`);

  etat = await recordFailure(compte);
  check('le sixième échec verrouille', etat.locked, `${etat.failures} échecs`);
  check('un délai d’attente est imposé', etat.retryAfter > 0, `${etat.retryAfter} s`);

  const premierDelai = etat.retryAfter;
  etat = await recordFailure(compte);
  check(
    'le délai croît à chaque nouvel échec',
    etat.retryAfter > premierDelai,
    `${premierDelai} s puis ${etat.retryAfter} s`,
  );

  const relu = await checkLock(compte);
  check('le verrou est bien persistant', relu.locked);

  await clearFailures(compte);
  const apres = await checkLock(compte);
  check('une connexion réussie lève le verrou', !apres.locked);

  /* --- Plafond du délai -------------------------------------------------- */

  console.log('\nPlafond du délai de verrouillage');

  const acharne = `test-acharne-${randomUUID()}`;
  let dernier = { retryAfter: 0 };
  for (let i = 0; i < 25; i++) dernier = await recordFailure(acharne);

  // Un verrouillage sans plafond serait une arme retournée contre le
  // propriétaire du compte : il suffirait de saisir de faux mots de passe pour
  // le bloquer le soir d'un concert.
  check(
    'le délai reste plafonné à 15 minutes',
    dernier.retryAfter <= 15 * 60 + 5,
    `${dernier.retryAfter} s`,
  );

  /* --- Nettoyage --------------------------------------------------------- */

  await db.execute(sql`DELETE FROM rate_limits WHERE bucket LIKE '%test-%'`);
  await db.execute(sql`DELETE FROM login_attempts WHERE identifier LIKE 'test-%'`);

  console.log('\n' + '='.repeat(44));
  if (failures === 0) {
    console.log('Les compteurs tiennent, y compris sous requêtes simultanées.');
    process.exit(0);
  } else {
    console.error(`${failures} contrôle(s) en échec.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Épreuve interrompue :', err);
  process.exit(1);
});
