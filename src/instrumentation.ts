/**
 * Point d'entrée exécuté une fois au démarrage du serveur Next.js, avant toute
 * requête.
 *
 * On y vérifie les secrets : en production, un `.env` resté sur les valeurs
 * d'exemple **empêche le démarrage**. Cette vérification n'a d'intérêt que si
 * elle a lieu ici — plus tard, l'application servirait déjà des billets
 * forgeables.
 */
export async function register(): Promise<void> {
  // L'import est dynamique et conditionnel : ce module touche à `process.exit`
  // et n'a pas sa place dans un environnement de rendu léger.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertSecretsAreSafe } = await import('./lib/security/config');
    assertSecretsAreSafe();
  }
}
