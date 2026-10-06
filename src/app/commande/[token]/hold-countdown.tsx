'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Timer } from 'lucide-react';

/**
 * Compte à rebours jusqu'à l'échéance RÉELLE de la commande (`hold_expires_at`).
 *
 * Purement informatif : c'est le worker qui expire la réservation, côté serveur.
 * Un compteur qui atteint zéro ne libère rien par lui-même ; il dit la vérité sur
 * l'état connu et redemande régulièrement au serveur où on en est.
 *
 * Quand le délai est dépassé, on ne prétend pas que la commande est déjà expirée
 * (le worker passe toutes les 30 s) : on l'annonce comme imminente, et la page se
 * met à jour d'elle-même dès que le statut change.
 */
export function HoldCountdown({ expiresAtIso }: { expiresAtIso: string }) {
  const router = useRouter();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const expiresAt = new Date(expiresAtIso).getTime();

    const tick = () => setRemaining(expiresAt - Date.now());
    tick();

    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAtIso]);

  // Après l'échéance, on interroge le serveur toutes les 10 s jusqu'à ce que
  // le statut change.
  const expired = remaining !== null && remaining <= 0;
  useEffect(() => {
    if (!expired) return;
    router.refresh();
    const id = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(id);
  }, [expired, router]);

  if (remaining === null) {
    // Même encombrement que le rendu final : pas de saut de mise en page.
    return <p className="mt-4 h-7" aria-hidden />;
  }

  if (expired) {
    return (
      <p className="mt-4 flex items-start gap-2 text-[0.9375rem] font-semibold" role="status">
        <Timer className="mt-0.5 size-5 shrink-0" aria-hidden />
        Délai dépassé : les places peuvent être remises en vente à tout moment.
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
    <p className="mt-4 flex items-center gap-2 text-[0.9375rem]">
      <Timer className="size-5 shrink-0" aria-hidden />
      {/* Volontairement sans `aria-live` : une annonce par seconde rendrait la page inutilisable au lecteur d'écran. */}
      <span>
        Temps restant : <strong className="tabular-nums">{label}</strong>
      </span>
    </p>
  );
}
