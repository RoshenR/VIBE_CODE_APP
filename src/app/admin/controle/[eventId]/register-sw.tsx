'use client';

import { useEffect } from 'react';

/**
 * Enregistre le service worker du poste de contrôle.
 *
 * Fait uniquement sur cette page : c'est la seule qui doit survivre à une perte
 * de réseau. Le reste du site n'a aucune raison d'être mis en cache — une page
 * de vente périmée afficherait des places qui n'existent plus.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Contexte non sécurisé ou navigateur restrictif : le scan en ligne
      // fonctionne quand même, seule la relecture hors ligne de la page est perdue.
    });
  }, []);

  return null;
}
