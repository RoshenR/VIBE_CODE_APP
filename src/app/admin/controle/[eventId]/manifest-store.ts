/**
 * Copie locale du manifeste des billets, conservée sur l'appareil de contrôle.
 *
 * Stockage : `localStorage`. Pour six cents billets, le manifeste pèse quelques
 * dizaines de kilo-octets — IndexedDB n'apporterait rien ici, et `localStorage`
 * est synchrone, donc trivial à relire au démarrage, y compris hors ligne.
 *
 * Le manifeste ne contient que des **empreintes** de jetons : impossible d'en
 * reconstituer un billet valide. Voir `buildManifest` côté serveur.
 */

export interface ManifestEntry {
  h: string; // empreinte SHA-256 du contenu du QR
  i: string; // identifiant du billet
  s: string; // numéro de série
  n: string; // nom du porteur
  t: string; // catégorie
  c: number | null; // déjà scanné (epoch ms) au moment du téléchargement
}

export interface StoredManifest {
  eventId: string;
  eventTitle: string;
  generatedAt: string;
  entries: ManifestEntry[];
}

export interface PendingScan {
  ticketId: string;
  scannedAt: string;
  deviceLabel: string;
}

const manifestKey = (eventId: string) => `ndg.manifest.${eventId}`;
const localScansKey = (eventId: string) => `ndg.localScans.${eventId}`;
const queueKey = (eventId: string) => `ndg.queue.${eventId}`;
const lastSyncKey = (eventId: string) => `ndg.lastSync.${eventId}`;
const conflictsKey = (eventId: string) => `ndg.conflicts.${eventId}`;
const deviceKey = 'ndg.device';

/** Toute lecture peut échouer (mode privé, quota) : jamais de plantage en salle. */
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota dépassé : on continue en mémoire plutôt que d'interrompre le contrôle.
  }
}

export function loadManifest(eventId: string): StoredManifest | null {
  return read<StoredManifest | null>(manifestKey(eventId), null);
}

export function saveManifest(manifest: StoredManifest): void {
  write(manifestKey(manifest.eventId), manifest);
}

/** Scans validés sur CET appareil : `ticketId → horodatage ISO`. */
export function loadLocalScans(eventId: string): Record<string, string> {
  return read<Record<string, string>>(localScansKey(eventId), {});
}

export function recordLocalScan(eventId: string, ticketId: string, scannedAt: string): void {
  const scans = loadLocalScans(eventId);
  // On ne remplace jamais un scan existant : le premier passage fait foi.
  if (scans[ticketId]) return;
  scans[ticketId] = scannedAt;
  write(localScansKey(eventId), scans);
}

/** Scans en attente d'envoi au serveur. */
export function loadQueue(eventId: string): PendingScan[] {
  return read<PendingScan[]>(queueKey(eventId), []);
}

export function enqueueScan(eventId: string, scan: PendingScan): void {
  const queue = loadQueue(eventId);
  if (queue.some((s) => s.ticketId === scan.ticketId)) return;
  queue.push(scan);
  write(queueKey(eventId), queue);
}

export function clearQueue(eventId: string, sent: PendingScan[]): void {
  const sentIds = new Set(sent.map((s) => s.ticketId));
  write(
    queueKey(eventId),
    loadQueue(eventId).filter((s) => !sentIds.has(s.ticketId)),
  );
}

/**
 * Horodatage (ISO) de la dernière synchronisation RÉUSSIE avec le serveur.
 *
 * Un envoi qui échoue ne le met jamais à jour : afficher « synchronisé à 21 h 04 »
 * pour une synchronisation qui n'a pas eu lieu serait un mensonge dangereux à la
 * porte.
 */
export function loadLastSync(eventId: string): string | null {
  return read<string | null>(lastSyncKey(eventId), null);
}

export function saveLastSync(eventId: string, iso: string): void {
  write(lastSyncKey(eventId), iso);
}

/** Conflit révélé à la synchronisation : un autre poste avait déjà validé ce billet. */
export interface StoredConflict {
  ticketId: string;
  serial: string;
  holderName: string | null;
  /** Premier passage enregistré par le serveur (ISO). */
  firstScanAt: string;
  /** Appareil qui a validé en premier. */
  firstDevice: string | null;
  /** Moment où CET appareil a accepté le même billet (ISO). */
  localScanAt: string | null;
}

/**
 * Les conflits restent affichés jusqu'à ce que l'équipe les ait vus et écartés :
 * ils survivent à un rechargement de la page, car c'est précisément au moment où
 * la connexion revient — et où l'on recharge — qu'ils apparaissent.
 */
export function loadConflicts(eventId: string): StoredConflict[] {
  return read<StoredConflict[]>(conflictsKey(eventId), []);
}

export function saveConflicts(eventId: string, conflicts: StoredConflict[]): void {
  write(conflictsKey(eventId), conflicts);
}

/**
 * Nom de l'appareil, stable d'une session à l'autre.
 *
 * Permet de distinguer « ce billet a déjà été scanné ici » de « il a été scanné
 * sur un autre poste », ce qui change complètement la réaction attendue à la
 * porte.
 */
export function getDeviceLabel(): string {
  try {
    const existing = localStorage.getItem(deviceKey);
    if (existing) return existing;
    const label = `poste-${Math.random().toString(36).slice(2, 6)}`;
    localStorage.setItem(deviceKey, label);
    return label;
  } catch {
    return 'poste-inconnu';
  }
}

/**
 * Empreinte d'un contenu de QR, identique à celle du serveur
 * (`createHash('sha256').digest('base64url')`).
 */
export async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token.trim());
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
