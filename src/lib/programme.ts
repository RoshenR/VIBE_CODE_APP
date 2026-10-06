/**
 * Règles d'affichage de la programmation — pures, donc testables sans base.
 */

export type SalesState = 'open' | 'soldout' | 'closed' | 'upcoming';

/**
 * En dessous de ce nombre de places restantes, on l'indique au visiteur.
 * Seuil unique, partagé par la programmation et la page de réservation : un
 * même événement ne doit pas afficher « plus que 8 places » ici et rien là.
 */
export const LOW_STOCK_THRESHOLD = 10;

export interface ProgrammeEvent {
  id: string;
  slug: string;
  startsAt: Date;
  isOnline: boolean;
  organizationName: string;
  organizationSlug: string;
  salesState: SalesState;
  totalAvailable: number;
}

/**
 * Concert mis en avant sur l'accueil.
 *
 * Règle simple et explicite, affichée telle quelle au visiteur (« Prochain
 * concert ») : le **prochain concert dont la vente est ouverte** ; à défaut, le
 * prochain concert tout court. Aucune pondération cachée, aucun événement choisi
 * à la main : le schéma n'a pas de champ « à la une » et on n'en crée pas.
 *
 * Attend une liste déjà triée par date croissante.
 */
export function pickFeaturedEvent<T extends ProgrammeEvent>(events: T[]): T | null {
  if (events.length === 0) return null;
  return events.find((e) => e.salesState === 'open') ?? events[0];
}

export interface ProgrammeFilters {
  /** `online` | `venue` — absent = tout. */
  format?: string;
  /** Slug d'un collectif — absent = tous. */
  collectif?: string;
}

export function filterEvents<T extends ProgrammeEvent>(
  events: T[],
  filters: ProgrammeFilters,
): T[] {
  return events.filter((event) => {
    if (filters.format === 'online' && !event.isOnline) return false;
    if (filters.format === 'venue' && event.isOnline) return false;
    if (filters.collectif && event.organizationSlug !== filters.collectif) return false;
    return true;
  });
}

/**
 * Les filtres ne sont proposés que s'ils changent réellement quelque chose :
 * un sélecteur « sur place / en ligne » devant une programmation où tout est sur
 * place n'est que du bruit.
 */
export function availableFilters(events: ProgrammeEvent[]) {
  const collectifs = new Map<string, string>();
  for (const event of events) collectifs.set(event.organizationSlug, event.organizationName);

  const hasOnline = events.some((e) => e.isOnline);
  const hasVenue = events.some((e) => !e.isOnline);

  return {
    canFilterByFormat: hasOnline && hasVenue,
    collectifs: collectifs.size > 1 ? [...collectifs].map(([slug, name]) => ({ slug, name })) : [],
  };
}

/**
 * Graine stable et rapide pour varier les compositions d'affiches.
 *
 * FNV-1a seul ne suffit pas : ses bits de poids faible ne dépendent que des bits
 * de poids faible des caractères, donc des slugs voisins retombent presque
 * toujours sur la même valeur modulo 4 (constaté : trois affiches identiques).
 * La finalisation de MurmurHash3 répartit l'information sur tous les bits.
 */
export function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/* -------------------------------------------------------------------------- */
/* État de la vente                                                           */
/* -------------------------------------------------------------------------- */

export interface SellableWindow {
  salesStartAt: Date | null;
  salesEndAt: Date | null;
  quantityTotal: number;
  quantityReserved: number;
}

/**
 * État global de la vente d'un événement, déduit de ses catégories.
 *
 *  • `upcoming` — aucune catégorie n'est encore ouverte à la vente ;
 *  • `closed`   — toutes les fenêtres de vente sont terminées ;
 *  • `soldout`  — des catégories sont ouvertes mais plus aucune place n'y reste ;
 *  • `open`     — au moins une place est achetable maintenant.
 *
 * Calculé uniquement à partir de l'état réel du serveur : aucun message
 * d'urgence ni compte à rebours n'est inventé côté interface.
 */
export function computeSalesState(types: SellableWindow[], now: Date = new Date()): SalesState {
  if (types.length === 0) return 'closed';

  const hasEnded = (t: SellableWindow) => t.salesEndAt !== null && now > t.salesEndAt;
  const hasNotStarted = (t: SellableWindow) => t.salesStartAt !== null && now < t.salesStartAt;

  if (types.every(hasEnded)) return 'closed';
  if (types.every((t) => hasNotStarted(t) || hasEnded(t)) && types.some(hasNotStarted)) {
    return 'upcoming';
  }

  const sellable = types.filter((t) => !hasEnded(t) && !hasNotStarted(t));
  const remaining = sellable.reduce(
    (sum, t) => sum + Math.max(0, t.quantityTotal - t.quantityReserved),
    0,
  );
  return remaining > 0 ? 'open' : 'soldout';
}

/* -------------------------------------------------------------------------- */
/* Titres                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Scinde « Nuit Électrique — Rocher de Palmer » en un titre principal et un
 * complément.
 *
 * Les titres de la billetterie suivent souvent la forme « Nom — Lieu ». Posé en
 * capitales condensées, le tiret long devient un trou dans la ligne ; on préfère
 * hiérarchiser : le nom en grand, le complément en dessous, plus petit. Le texte
 * complet reste lisible par les lecteurs d'écran (voir `EventTitle`).
 *
 * Un titre sans séparateur est renvoyé tel quel.
 */
export function splitTitle(title: string): { main: string; sub: string | null } {
  const index = title.indexOf(' — ');
  if (index === -1) return { main: title, sub: null };

  const main = title.slice(0, index).trim();
  const sub = title.slice(index + 3).trim();
  return main && sub ? { main, sub } : { main: title, sub: null };
}
