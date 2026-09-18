'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Compte à rebours avant expiration de la réservation.
 *
 * Purement informatif : l'expiration réelle est décidée par le worker, côté
 * serveur. Un compteur qui atteint zéro ne libère rien par lui-même — il
 * rafraîchit simplement la page pour montrer l'état réel.
 */
export function HoldCountdown({ expiresAtIso }: { expiresAtIso: string }) {
  const router = useRouter();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const expiresAt = new Date(expiresAtIso).getTime();

    const tick = () => {
      const left = expiresAt - Date.now();
      setRemaining(left);
      // Un instant de marge pour laisser le worker faire son travail.
      if (left <= -2000) router.refresh();
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAtIso, router]);

  if (remaining === null) return null;

  if (remaining <= 0) {
    return (
      <p className="mt-3 text-sm font-medium text-amber-900">
        Le délai est écoulé, mise à jour en cours…
      </p>
    );
  }

  const totalMinutes = Math.floor(remaining / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const seconds = Math.floor((remaining % 60000) / 1000);

  const label =
    days > 0
      ? `${days} j ${hours} h`
      : hours > 0
        ? `${hours} h ${String(minutes).padStart(2, '0')} min`
        : `${minutes} min ${String(seconds).padStart(2, '0')} s`;

  return (
    <p className="mt-3 text-sm text-amber-900" aria-live="polite">
      Temps restant&nbsp;: <strong className="tabular-nums">{label}</strong>
    </p>
  );
}
