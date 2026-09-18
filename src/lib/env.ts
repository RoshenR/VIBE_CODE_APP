/**
 * Charge le fichier .env pour les scripts hors Next.js (worker, migrations,
 * jeu de données de démonstration). Next.js le fait déjà de son côté.
 *
 * Volontairement silencieux : en production, les variables viennent de
 * l'environnement Docker et aucun fichier .env n'existe.
 */
export function loadEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Pas de fichier .env : on s'appuie sur l'environnement du conteneur.
  }
}
