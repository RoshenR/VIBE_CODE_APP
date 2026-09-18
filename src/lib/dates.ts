/**
 * Tous les horodatages sont stockés en UTC (`timestamptz`). L'affichage se fait
 * toujours dans un fuseau explicite : celui du lieu, et le cas échéant celui du
 * visiteur — le collectif partenaire organise des événements en ligne suivis
 * depuis l'étranger, et « 20 h » sans fuseau n'y veut rien dire.
 */

const LOCALE = 'fr-FR';

export function formatInZone(
  date: Date,
  timezone: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: timezone,
    dateStyle: 'full',
    timeStyle: 'short',
    ...options,
  }).format(date);
}

export function formatDateTime(date: Date, timezone: string): string {
  return formatInZone(date, timezone, { dateStyle: 'full', timeStyle: 'short' });
}

export function formatShort(date: Date, timezone: string): string {
  return formatInZone(date, timezone, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatTime(date: Date, timezone: string): string {
  return formatInZone(date, timezone, { dateStyle: undefined, timeStyle: 'short' });
}

/** Abréviation du fuseau telle qu'affichée à côté de l'heure (ex. « UTC+2 »). */
export function zoneLabel(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat(LOCALE, {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? timezone;
}

/**
 * Affichage destiné aux participants potentiellement à l'étranger : heure locale
 * du lieu, puis heure du visiteur si son fuseau diffère réellement.
 */
export function formatWithViewerZone(
  date: Date,
  eventTimezone: string,
  viewerTimezone?: string | null,
): { primary: string; secondary: string | null } {
  const primary = `${formatDateTime(date, eventTimezone)} (${zoneLabel(date, eventTimezone)})`;

  if (!viewerTimezone || viewerTimezone === eventTimezone) {
    return { primary, secondary: null };
  }
  // Même décalage horaire (ex. Europe/Paris vs Europe/Madrid) : inutile de répéter.
  if (offsetMinutes(date, viewerTimezone) === offsetMinutes(date, eventTimezone)) {
    return { primary, secondary: null };
  }
  const secondary = `Soit ${formatDateTime(date, viewerTimezone)} chez vous (${zoneLabel(
    date,
    viewerTimezone,
  )})`;
  return { primary, secondary };
}

function offsetMinutes(date: Date, timezone: string): number {
  // Reconstitue l'heure murale dans le fuseau, puis mesure l'écart avec l'UTC.
  const asUtc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const asZone = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  return Math.round((asZone.getTime() - asUtc.getTime()) / 60000);
}

/** Compte à rebours lisible, utilisé pour les réservations en attente de paiement. */
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return 'expirée';
  const totalMinutes = Math.floor(msRemaining / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  const seconds = Math.floor((msRemaining % 60000) / 1000);
  return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
}

/**
 * Valeur d'un `<input type="datetime-local">` correspondant à l'heure murale du
 * fuseau donné.
 *
 * `date.toISOString().slice(0, 16)` donnerait l'heure UTC : un concert à 20 h 30
 * à Bordeaux s'afficherait « 18:30 » dans le formulaire. On reconstruit donc
 * l'heure telle qu'elle est lue sur place.
 */
export function toLocalInputValue(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';

  // `hourCycle` peut produire « 24 » à minuit selon l'environnement.
  const hour = get('hour') === '24' ? '00' : get('hour');

  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
