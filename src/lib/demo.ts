/**
 * Le paiement est-il simulé ?
 *
 * Tant qu'aucun vrai prestataire n'est branché, le paiement passe par le
 * simulateur intégré : aucun argent n'est débité. L'interface le dit
 * explicitement, aux endroits où un visiteur pourrait croire le contraire —
 * on ne présente jamais une simulation comme un encaissement réel.
 *
 * Lecture côté serveur uniquement ; les composants clients reçoivent la valeur
 * en propriété.
 */
export function isPaymentSimulated(): boolean {
  return (process.env.PAYMENT_PROVIDER ?? 'simulator') === 'simulator';
}
