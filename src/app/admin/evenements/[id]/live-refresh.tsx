'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Rafraîchit le tableau de bord à intervalle régulier.
 *
 * Le soir d'un concert, les chiffres bougent en permanence. Un simple
 * `router.refresh()` suffit ici : à l'échelle de l'audience de l'admin (quelques
 * personnes), ouvrir une connexion temps réel serait disproportionné.
 *
 * Le rafraîchissement s'interrompt quand l'onglet passe en arrière-plan, pour ne
 * pas consommer la batterie d'un téléphone posé dans une poche pendant la soirée.
 */
export function LiveRefresh({ intervalMs = 20_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => router.refresh(), intervalMs);
    };

    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        router.refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [router, intervalMs]);

  return null;
}
