'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/org';
import * as audit from '@/lib/security/audit';
import { currentContext } from '../../actions';
import {
  createEvent,
  createTicketType,
  deleteTicketType,
  EventError,
  setEventStatus,
  updateEventSettings,
  updateTicketType,
} from '@/server/events';
import { eventFormSchema, ticketTypeFormSchema } from '@/lib/validation';

export type FormState = { error: string | null; ok?: boolean };

/**
 * Actions de configuration des événements.
 *
 * Chacune vérifie une permission précise — un compte « poste d'entrée » ne doit
 * pas pouvoir modifier une jauge — et laisse une trace nominative dans le
 * journal d'audit.
 */

/**
 * Convertit une saisie « heure locale du lieu » en instant UTC.
 *
 * L'organisateur saisit « 20:30 » en pensant à l'heure de la salle. Un
 * `new Date('2026-04-15T20:30')` interpréterait cela dans le fuseau du serveur —
 * faux dès que le serveur n'est pas à Paris, ou pour un événement dans un autre
 * fuseau. On mesure donc l'écart réel du fuseau à cette date, changements
 * d'heure compris.
 */
function localInputToUtc(value: string, timezone: string): Date {
  // `value` a la forme "2026-04-15T20:30" produite par <input type="datetime-local">.
  const naive = new Date(`${value}:00Z`); // lu comme si c'était de l'UTC
  if (Number.isNaN(naive.getTime())) throw new EventError('invalid', 'Date invalide.');

  // Décalage du fuseau à cet instant approximatif…
  const offset = zoneOffsetMs(naive, timezone);
  // …puis correction, et seconde passe pour les dates proches d'un changement d'heure.
  const firstGuess = new Date(naive.getTime() - offset);
  return new Date(naive.getTime() - zoneOffsetMs(firstGuess, timezone));
}

function zoneOffsetMs(instant: Date, timezone: string): number {
  const asUtc = new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }));
  const asZone = new Date(instant.toLocaleString('en-US', { timeZone: timezone }));
  return asZone.getTime() - asUtc.getTime();
}

function euroToCents(value: FormDataEntryValue | null): number {
  const raw = String(value ?? '0').replace(',', '.').trim();
  const amount = Number.parseFloat(raw);
  if (Number.isNaN(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
}

function readEventForm(formData: FormData) {
  return eventFormSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description') ?? '',
    venueName: formData.get('venueName'),
    venueAddress: formData.get('venueAddress'),
    isOnline: formData.get('isOnline') === 'on',
    onlineUrl: formData.get('onlineUrl'),
    timezone: formData.get('timezone'),
    startsAt: formData.get('startsAt'),
    doorsAt: formData.get('doorsAt'),
    holdMinutesCard: formData.get('holdMinutesCard'),
    holdHoursTransfer: formData.get('holdHoursTransfer'),
    waitlistOfferHours: formData.get('waitlistOfferHours'),
    cancellationDeadlineHours: formData.get('cancellationDeadlineHours'),
  });
}

/* -------------------------------------------------------------------------- */
/* Événements                                                                 */
/* -------------------------------------------------------------------------- */

export async function createEventAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requirePermission('evenement.creer');

  const parsed = readEventForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Formulaire incomplet.' };
  }

  const input = parsed.data;
  let eventId: string;

  try {
    eventId = await createEvent(user.organizationId, {
      ...input,
      onlineUrl: input.onlineUrl || null,
      startsAt: localInputToUtc(input.startsAt, input.timezone),
      doorsAt: input.doorsAt ? localInputToUtc(input.doorsAt, input.timezone) : null,
    });
  } catch (err) {
    return { error: err instanceof EventError ? err.message : 'Création impossible.' };
  }

  await audit.record({
    action: 'evenement.cree',
    organizationId: user.organizationId,
    userId: user.id,
    targetType: 'event',
    targetId: eventId,
    metadata: { titre: input.title },
    ...(await currentContext()),
  });

  redirect(`/admin/evenements/${eventId}/reglages`);
}

export async function updateEventAction(
  eventId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requirePermission('evenement.modifier');

  const parsed = readEventForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Formulaire incomplet.' };
  }

  const input = parsed.data;

  try {
    await updateEventSettings(user.organizationId, eventId, {
      title: input.title,
      description: input.description,
      venueName: input.venueName ?? null,
      venueAddress: input.venueAddress ?? null,
      timezone: input.timezone,
      startsAt: localInputToUtc(input.startsAt, input.timezone),
      doorsAt: input.doorsAt ? localInputToUtc(input.doorsAt, input.timezone) : null,
      holdMinutesCard: input.holdMinutesCard,
      holdHoursTransfer: input.holdHoursTransfer,
      waitlistOfferHours: input.waitlistOfferHours,
      cancellationDeadlineHours: input.cancellationDeadlineHours,
    });
  } catch (err) {
    return { error: err instanceof EventError ? err.message : 'Enregistrement impossible.' };
  }

  await audit.record({
    action: 'evenement.modifie',
    organizationId: user.organizationId,
    userId: user.id,
    targetType: 'event',
    targetId: eventId,
    metadata: {
      titre: input.title,
      delai_carte_min: input.holdMinutesCard,
      delai_virement_h: input.holdHoursTransfer,
    },
    ...(await currentContext()),
  });

  revalidatePath(`/admin/evenements/${eventId}/reglages`);
  return { error: null, ok: true };
}

export async function setStatusAction(
  eventId: string,
  status: 'draft' | 'published' | 'cancelled',
): Promise<FormState> {
  const user = await requirePermission('evenement.publier');

  try {
    await setEventStatus(user.organizationId, eventId, status);
  } catch (err) {
    return { error: err instanceof EventError ? err.message : 'Changement impossible.' };
  }

  await audit.record({
    action: status === 'published' ? 'evenement.publie' : 'evenement.suspendu',
    organizationId: user.organizationId,
    userId: user.id,
    targetType: 'event',
    targetId: eventId,
    metadata: { statut: status },
    ...(await currentContext()),
  });

  revalidatePath(`/admin/evenements/${eventId}`);
  revalidatePath(`/admin/evenements/${eventId}/reglages`);
  return { error: null, ok: true };
}

/* -------------------------------------------------------------------------- */
/* Catégories de places                                                       */
/* -------------------------------------------------------------------------- */

export async function saveTicketTypeAction(
  eventId: string,
  ticketTypeId: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requirePermission('evenement.modifier');

  const parsed = ticketTypeFormSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description') ?? '',
    priceCents: euroToCents(formData.get('price')),
    earlyPriceCents: formData.get('earlyPrice') ? euroToCents(formData.get('earlyPrice')) : null,
    earlyEndsAt: formData.get('earlyEndsAt') || null,
    quantityTotal: formData.get('quantityTotal'),
    maxPerOrder: formData.get('maxPerOrder'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Formulaire incomplet.' };
  }

  const input = parsed.data;
  const payload = {
    name: input.name,
    description: input.description,
    priceCents: input.priceCents,
    earlyPriceCents: input.earlyPriceCents ?? null,
    earlyEndsAt: input.earlyEndsAt ? new Date(input.earlyEndsAt) : null,
    quantityTotal: input.quantityTotal,
    maxPerOrder: input.maxPerOrder,
  };

  try {
    if (ticketTypeId) {
      await updateTicketType(user.organizationId, eventId, ticketTypeId, payload);
    } else {
      await createTicketType(user.organizationId, eventId, payload);
    }
  } catch (err) {
    return { error: err instanceof EventError ? err.message : 'Enregistrement impossible.' };
  }

  // La jauge est journalisée explicitement : c'est le réglage qui, mal manipulé,
  // provoquerait exactement l'incident que tout le reste s'emploie à empêcher.
  await audit.record({
    action: ticketTypeId ? 'categorie.modifiee' : 'categorie.creee',
    organizationId: user.organizationId,
    userId: user.id,
    targetType: 'ticket_type',
    targetId: ticketTypeId ?? input.name,
    metadata: {
      nom: input.name,
      jauge: input.quantityTotal,
      prix_centimes: input.priceCents,
      evenement: eventId,
    },
    ...(await currentContext()),
  });

  revalidatePath(`/admin/evenements/${eventId}/reglages`);
  revalidatePath(`/admin/evenements/${eventId}`);
  return { error: null, ok: true };
}

export async function deleteTicketTypeAction(
  eventId: string,
  ticketTypeId: string,
): Promise<FormState> {
  const user = await requirePermission('evenement.modifier');

  try {
    await deleteTicketType(user.organizationId, eventId, ticketTypeId);
  } catch (err) {
    return { error: err instanceof EventError ? err.message : 'Suppression impossible.' };
  }

  await audit.record({
    action: 'categorie.supprimee',
    organizationId: user.organizationId,
    userId: user.id,
    targetType: 'ticket_type',
    targetId: ticketTypeId,
    metadata: { evenement: eventId },
    ...(await currentContext()),
  });

  revalidatePath(`/admin/evenements/${eventId}/reglages`);
  return { error: null, ok: true };
}
