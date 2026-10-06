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
  // « 6 oct. 2026 à 10 h 35 » : même écriture de l'heure que sur le reste du site.
  const day = new Intl.DateTimeFormat(LOCALE, {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
  return `${day} à ${formatClock(date, timezone)}`;
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

/* -------------------------------------------------------------------------- */
/* Affichage éditorial                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Heure à la française : « 20 h 30 », « 19 h » (pas de « :00 » inutile).
 *
 * `hourCycle: 'h23'` évite le « 24 h 05 » que certains environnements produisent
 * pour minuit.
 */
export function formatClock(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return minute === '00' ? `${hour} h` : `${hour} h ${minute}`;
}

/** « mardi 27 octobre 2026 » — sans l'heure. */
export function formatLongDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export interface DateParts {
  weekday: string; // « mardi »
  weekdayShort: string; // « mar. »
  day: string; // « 27 »
  month: string; // « octobre »
  monthShort: string; // « oct. »
  year: string; // « 2026 »
  clock: string; // « 19 h 30 »
}

/**
 * Composantes d'une date dans le fuseau du lieu, pour les affiches et les blocs
 * de date très identifiables. Toujours calculées dans le fuseau de l'événement :
 * un concert à 00 h 30 à Bordeaux tombe la veille à Montréal, et l'affiche doit
 * porter le jour du lieu.
 */
export function dateParts(date: Date, timezone: string): DateParts {
  const f = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('fr-FR', { timeZone: timezone, ...options }).format(date);

  return {
    weekday: f({ weekday: 'long' }),
    weekdayShort: f({ weekday: 'short' }),
    day: f({ day: 'numeric' }),
    month: f({ month: 'long' }),
    monthShort: f({ month: 'short' }),
    year: f({ year: 'numeric' }),
    clock: formatClock(date, timezone),
  };
}

/**
 * Nom d'usage d'un fuseau IANA : « Europe/Paris » → « Paris ».
 *
 * Sert à écrire « heure de Paris » : plus parlant pour un spectateur étranger
 * qu'un « UTC+1 » seul, que l'on garde en complément.
 */
export function zoneCity(timezone: string): string {
  return (timezone.split('/').pop() ?? timezone).replace(/_/g, ' ');
}

/**
 * Durée de maintien d'une réservation, en toutes lettres : « 15 minutes »,
 * « 6 heures », « 3 jours ».
 */
export function formatHoldDuration(minutes: number): string {
  if (minutes < 120) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  const hours = Math.round(minutes / 60);
  if (hours >= 48 && hours % 24 === 0) return `${hours / 24} jours`;
  return `${hours} heures`;
}

/* -------------------------------------------------------------------------- */
/* Heure murale → instant UTC                                                 */
/* -------------------------------------------------------------------------- */

function zoneOffsetMs(instant: Date, timezone: string): number {
  const asUtc = new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }));
  const asZone = new Date(instant.toLocaleString('en-US', { timeZone: timezone }));
  return asZone.getTime() - asUtc.getTime();
}

/**
 * Convertit « le 27 octobre 2026 à 20 h 30, à Paris » en instant UTC.
 *
 * Mesure l'écart réel du fuseau à CETTE date (heure d'été comprise) plutôt que
 * d'en supposer un : sans cela, un concert saisi à 20 h 30 s'affichait 19 h 30
 * après le passage à l'heure d'hiver. Une seconde passe corrige les dates proches
 * d'un changement d'heure.
 */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const first = zoneOffsetMs(new Date(naive), timezone);
  const guess = naive - first;
  const second = zoneOffsetMs(new Date(guess), timezone);
  return new Date(second === first ? guess : naive - second);
}
