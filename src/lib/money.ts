/**
 * Les montants sont toujours manipulés en centimes (entiers). Aucun flottant :
 * 0.1 + 0.2 !== 0.3, et une billetterie qui arrondit mal finit en écart de caisse.
 */

export function formatCents(cents: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatPrice(cents: number, currency = 'EUR'): string {
  return cents === 0 ? 'Gratuit' : formatCents(cents, currency);
}

/**
 * Prix applicable à une catégorie à un instant donné.
 *
 * Le tarif « early » s'applique automatiquement tant que sa date de fin n'est pas
 * dépassée : l'équipe n'a rien à basculer manuellement le jour J.
 */
export function resolvePrice(
  ticketType: {
    priceCents: number;
    earlyPriceCents: number | null;
    earlyEndsAt: Date | null;
  },
  now: Date = new Date(),
): { cents: number; label: 'standard' | 'early' } {
  const { priceCents, earlyPriceCents, earlyEndsAt } = ticketType;

  if (earlyPriceCents !== null && earlyEndsAt !== null && now < earlyEndsAt) {
    return { cents: earlyPriceCents, label: 'early' };
  }
  return { cents: priceCents, label: 'standard' };
}
