import { z } from 'zod';
import { isValidTimezone } from './dates';

/**
 * Toute donnée venant du navigateur est validée ici avant d'atteindre la base.
 * Les prix, eux, ne sont jamais acceptés depuis le client : ils sont recalculés
 * côté serveur (voir orders.ts).
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Adresse e-mail requise')
  .max(254)
  .email('Adresse e-mail invalide');

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Nom trop court')
  .max(120, 'Nom trop long');

export const cartLineSchema = z.object({
  ticketTypeId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
});

export const createHoldSchema = z.object({
  eventSlug: z.string().min(1).max(120),
  lines: z.array(cartLineSchema).min(1, 'Sélectionnez au moins une place').max(10),
  name: nameSchema,
  email: emailSchema,
  phone: z.string().trim().max(30).optional().nullable(),
  paymentMethod: z.enum(['card', 'transfer']),
  // Fuseau du navigateur, pour afficher des horaires justes aux participants
  // à l'étranger. Rejeté s'il n'est pas reconnu plutôt que stocké tel quel.
  timezone: z
    .string()
    .max(64)
    .optional()
    .nullable()
    .refine((tz) => !tz || isValidTimezone(tz), 'Fuseau horaire inconnu'),
});

export const joinWaitlistSchema = z.object({
  eventId: z.string().uuid(),
  ticketTypeId: z.string().uuid().optional().nullable(),
  name: nameSchema,
  email: emailSchema,
  quantity: z.number().int().min(1).max(6),
});

export const acceptOfferSchema = z.object({
  offerToken: z.string().min(10).max(200),
  name: nameSchema,
  email: emailSchema,
  phone: z.string().trim().max(30).optional().nullable(),
  paymentMethod: z.enum(['card', 'transfer']),
  timezone: z.string().max(64).optional().nullable(),
});

export const offlineScanSchema = z.object({
  eventId: z.string().uuid(),
  deviceLabel: z.string().max(60).optional(),
  scans: z
    .array(
      z.object({
        ticketId: z.string().uuid(),
        scannedAt: z.string().datetime(),
        deviceLabel: z.string().max(60).optional(),
      }),
    )
    .max(2000),
});

export const scanSchema = z.object({
  token: z.string().min(10).max(500),
  eventId: z.string().uuid(),
  deviceLabel: z.string().max(60).optional(),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Mot de passe requis').max(200),
});

export const eventFormSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).default(''),
  venueName: z.string().trim().max(160).optional().nullable(),
  venueAddress: z.string().trim().max(240).optional().nullable(),
  isOnline: z.boolean().default(false),
  onlineUrl: z.string().url().max(500).optional().nullable().or(z.literal('')),
  timezone: z.string().refine(isValidTimezone, 'Fuseau horaire inconnu'),
  startsAt: z.string().min(1),
  doorsAt: z.string().optional().nullable(),
  holdMinutesCard: z.coerce.number().int().min(2).max(1440),
  holdHoursTransfer: z.coerce.number().int().min(1).max(720),
  waitlistOfferHours: z.coerce.number().int().min(1).max(168),
  cancellationDeadlineHours: z.coerce.number().int().min(0).max(720),
});

export const ticketTypeFormSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  priceCents: z.coerce.number().int().min(0).max(1_000_000),
  earlyPriceCents: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
  earlyEndsAt: z.string().optional().nullable(),
  quantityTotal: z.coerce.number().int().min(1).max(100_000),
  maxPerOrder: z.coerce.number().int().min(1).max(50),
});

export type CreateHoldInput = z.infer<typeof createHoldSchema>;
export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;
