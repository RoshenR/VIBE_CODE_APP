/*
 * Service worker du poste de contrôle.
 *
 * Objectif unique : que la page de scan s'ouvre même sans réseau, à l'entrée
 * d'une salle où la 4G ne passe pas. Les données des billets, elles, sont déjà
 * en localStorage (voir manifest-store.ts) — ce fichier ne s'occupe que de la
 * coquille de l'application.
 *
 * Stratégie « réseau d'abord, cache en secours » : on préfère toujours la
 * version à jour, mais on ne reste jamais bloqué sur une page blanche.
 */

const CACHE = 'ndg-checkin-v1';
const SHELL = ['/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Seules les navigations GET nous intéressent. Les appels d'API doivent
  // échouer franchement hors ligne : l'application sait déjà les mettre en file,
  // et une réponse servie depuis le cache lui ferait croire à un succès.
  if (request.method !== 'GET') return;
  if (new URL(request.url).pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && request.mode === 'navigate') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>Hors ligne</title>' +
            '<body style="font-family:system-ui;padding:2rem;text-align:center">' +
            '<h1>Page indisponible hors ligne</h1>' +
            '<p>Ouvrez cette page une fois avec du réseau pour pouvoir la réutiliser sans connexion.</p>',
          { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }),
  );
});
