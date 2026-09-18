/**
 * Modèle de droits.
 *
 * Module volontairement **pur** : aucune dépendance à Next.js, à la base, ni à
 * la session. La matrice des droits est de la logique métier, pas de la
 * plomberie serveur — et elle doit pouvoir être éprouvée par un test qui ne
 * démarre ni framework ni base de données.
 */

/**
 * Trois rôles, pensés à partir de qui manipule réellement l'outil :
 *
 *  • `owner`   — responsable du collectif : tarifs, jauges, mise en vente,
 *                remboursements, comptes ;
 *  • `staff`   — équipe : suivi des ventes, annulations, exports, contrôle ;
 *  • `scanner` — poste d'entrée. Le téléphone passe de main en main toute la
 *                soirée et reste parfois déverrouillé sur une table. Il ne doit
 *                pouvoir **que** scanner : ni voir l'encaissé, ni toucher aux
 *                tarifs, ni exporter le fichier des participants.
 */
export const PERMISSIONS = {
  owner: [
    'evenement.creer',
    'evenement.modifier',
    'evenement.publier',
    'commande.annuler',
    'commande.rembourser',
    'chiffres.lire',
    'participants.exporter',
    'billets.scanner',
    'compte.gerer',
  ],
  staff: [
    'commande.annuler',
    'chiffres.lire',
    'participants.exporter',
    'billets.scanner',
  ],
  scanner: ['billets.scanner'],
} as const;

export type Role = keyof typeof PERMISSIONS;
export type Permission = (typeof PERMISSIONS)[Role][number];

export function can(user: { role: Role }, permission: Permission): boolean {
  return (PERMISSIONS[user.role] as readonly string[]).includes(permission);
}
