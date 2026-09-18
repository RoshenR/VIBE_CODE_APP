import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/* -------------------------------------------------------------------------- */
/* Énumérations                                                               */
/* -------------------------------------------------------------------------- */

export const userRole = pgEnum('user_role', ['owner', 'staff', 'scanner']);
export const eventStatus = pgEnum('event_status', ['draft', 'published', 'cancelled', 'archived']);
export const orderStatus = pgEnum('order_status', [
  'pending', // réservation en cours, détient du stock jusqu'à hold_expires_at
  'paid',
  'expired', // non payée à temps, stock relâché
  'cancelled',
  'refunded',
]);
export const paymentMethod = pgEnum('payment_method', ['card', 'transfer', 'free']);
export const ticketStatus = pgEnum('ticket_status', ['valid', 'cancelled', 'refunded']);
export const priceLabel = pgEnum('price_label', ['standard', 'early']);
export const waitlistStatus = pgEnum('waitlist_status', [
  'waiting',
  'offered', // des places lui sont réservées jusqu'à offer_expires_at
  'converted',
  'expired',
  'cancelled',
]);
export const checkinResult = pgEnum('checkin_result', [
  'ok',
  'already', // déjà scanné : le cas des captures d'écran
  'invalid', // signature fausse ou billet inconnu
  'wrong_event',
  'cancelled',
]);
export const outboxStatus = pgEnum('outbox_status', ['pending', 'sent', 'failed']);

/* -------------------------------------------------------------------------- */
/* Collectifs et comptes                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Un collectif organisateur. Racine de l'isolation : deux collectifs ne doivent
 * jamais voir les données l'un de l'autre.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    contactEmail: text('contact_email').notNull(),
    timezone: text('timezone').notNull().default('Europe/Paris'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('organizations_slug_key').on(t.slug)],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    role: userRole('role').notNull().default('staff'),

    /** Secret TOTP en base32. Null tant que la double authentification est inactive. */
    totpSecret: text('totp_secret'),
    totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
    /** Codes de secours, stockés hachés : perdre son téléphone ne doit pas tout bloquer. */
    totpRecoveryCodes: jsonb('totp_recovery_codes').$type<string[]>().notNull().default([]),

    /**
     * Toute session créée avant cette date est refusée.
     *
     * Permet de déconnecter partout en une écriture — après un changement de mot
     * de passe, ou un téléphone perdu — sans courir après les lignes de sessions.
     */
    sessionsValidFrom: timestamp('sessions_valid_from', { withTimezone: true })
      .notNull()
      .defaultNow(),

    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email), index('users_org_idx').on(t.organizationId)],
);

export const sessions = pgTable(
  'sessions',
  {
    /**
     * Empreinte SHA-256 du jeton de session, jamais le jeton lui-même.
     *
     * Une fuite de la table — sauvegarde égarée, injection SQL en lecture — ne
     * livre alors aucune session utilisable : il faudrait inverser le hachage.
     */
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Échéance absolue : une session ne vit jamais au-delà, même très active. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Dernière activité : sert à l'expiration par inactivité. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),

    /** Contexte de création, affiché dans « mes sessions actives ». */
    ipPrefix: text('ip_prefix'),
    userAgent: text('user_agent'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expiry_idx').on(t.expiresAt)],
);

/* -------------------------------------------------------------------------- */
/* Événements et catégories de places                                         */
/* -------------------------------------------------------------------------- */

export const events = pgTable(
  'events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    posterUrl: text('poster_url'),

    // Lieu physique ou événement en ligne (cas du collectif partenaire).
    isOnline: boolean('is_online').notNull().default(false),
    onlineUrl: text('online_url'),
    venueName: text('venue_name'),
    venueAddress: text('venue_address'),

    /**
     * Fuseau IANA du lieu (ex. 'Europe/Paris'). Les horodatages sont stockés en
     * UTC ; ce champ permet de les afficher correctement, y compris pour les
     * participants à l'étranger.
     */
    timezone: text('timezone').notNull().default('Europe/Paris'),
    doorsAt: timestamp('doors_at', { withTimezone: true }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),

    status: eventStatus('status').notNull().default('draft'),

    /** Délai de rétention d'une réservation par carte, en minutes. */
    holdMinutesCard: integer('hold_minutes_card').notNull().default(15),
    /** Délai de rétention d'une réservation par virement, en heures. */
    holdHoursTransfer: integer('hold_hours_transfer').notNull().default(72),
    /** Fenêtre de réponse laissée à un inscrit en liste d'attente, en heures. */
    waitlistOfferHours: integer('waitlist_offer_hours').notNull().default(6),
    /** Annulation autonome possible jusqu'à N heures avant le début. */
    cancellationDeadlineHours: integer('cancellation_deadline_hours').notNull().default(48),

    /**
     * Plafond de places par adresse e-mail, toutes commandes confondues.
     *
     * `maxPerOrder` limite un panier ; rien n'empêche de repasser dix fois.
     * Ce plafond-ci borne le total et coupe court à la revente automatisée, qui
     * est la raison pour laquelle une jauge de 80 places part en trois minutes.
     */
    maxTicketsPerEmail: integer('max_tickets_per_email').notNull().default(10),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('events_slug_key').on(t.slug),
    index('events_org_idx').on(t.organizationId),
    index('events_status_starts_idx').on(t.status, t.startsAt),
  ],
);

/**
 * Une catégorie de places (fosse, balcon, standard, VIP...).
 *
 * `quantityReserved` porte la garantie anti-survente : il compte les places
 * détenues, qu'elles soient en cours de réservation ou déjà payées. Toute
 * allocation passe par un UPDATE conditionnel atomique — jamais par une lecture
 * suivie d'une écriture. Voir src/server/inventory.ts.
 */
export const ticketTypes = pgTable(
  'ticket_types',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    position: integer('position').notNull().default(0),

    priceCents: integer('price_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),

    /** Tarif early : appliqué automatiquement tant que earlyEndsAt n'est pas dépassé. */
    earlyPriceCents: integer('early_price_cents'),
    earlyEndsAt: timestamp('early_ends_at', { withTimezone: true }),

    quantityTotal: integer('quantity_total').notNull(),
    /** Places détenues : réservations en cours + payées. */
    quantityReserved: integer('quantity_reserved').notNull().default(0),
    /** Places effectivement payées, pour le reporting. */
    quantitySold: integer('quantity_sold').notNull().default(0),

    maxPerOrder: integer('max_per_order').notNull().default(6),
    salesStartAt: timestamp('sales_start_at', { withTimezone: true }),
    salesEndAt: timestamp('sales_end_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ticket_types_event_idx').on(t.eventId, t.position)],
);

/* -------------------------------------------------------------------------- */
/* Commandes                                                                  */
/* -------------------------------------------------------------------------- */

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),

    /** Référence lisible communiquée au client (ex. NDG-7F3K2). */
    reference: text('reference').notNull(),

    customerName: text('customer_name').notNull(),
    customerEmail: text('customer_email').notNull(),
    customerPhone: text('customer_phone'),
    /** Fuseau déclaré par le navigateur du client, pour l'affichage des e-mails. */
    customerTimezone: text('customer_timezone'),

    status: orderStatus('status').notNull().default('pending'),
    paymentMethod: paymentMethod('payment_method').notNull().default('card'),
    totalCents: integer('total_cents').notNull().default(0),
    currency: text('currency').notNull().default('EUR'),

    /** Au-delà de cette date, le worker relâche les places. */
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    /** Évite d'envoyer deux fois le rappel « votre réservation expire bientôt ». */
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),

    /** Jeton du lien de gestion envoyé par e-mail (billets + annulation). */
    manageToken: text('manage_token').notNull(),

    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by'), // 'customer' | 'organizer' | 'system'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('orders_reference_key').on(t.reference),
    uniqueIndex('orders_manage_token_key').on(t.manageToken),
    index('orders_event_status_idx').on(t.eventId, t.status),
    index('orders_org_idx').on(t.organizationId),
    // Sert au balayage du worker : ne parcourt que les réservations à expirer.
    index('orders_hold_expiry_idx').on(t.status, t.holdExpiresAt),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    ticketTypeId: uuid('ticket_type_id')
      .notNull()
      .references(() => ticketTypes.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    subtotalCents: integer('subtotal_cents').notNull(),
    appliedPrice: priceLabel('applied_price').notNull().default('standard'),
  },
  (t) => [index('order_items_order_idx').on(t.orderId)],
);

/* -------------------------------------------------------------------------- */
/* Billets                                                                    */
/* -------------------------------------------------------------------------- */

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    ticketTypeId: uuid('ticket_type_id')
      .notNull()
      .references(() => ticketTypes.id, { onDelete: 'restrict' }),

    /** Identifiant court imprimé sur le billet (ex. NDG-7F3K2-03). */
    serial: text('serial').notNull(),
    holderName: text('holder_name').notNull(),
    status: ticketStatus('status').notNull().default('valid'),

    /**
     * Première validation à l'entrée. Les scans suivants ne l'écrasent pas :
     * c'est ce qui neutralise une capture d'écran présentée deux fois.
     */
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    checkedInBy: uuid('checked_in_by').references(() => users.id, { onDelete: 'set null' }),
    checkedInDevice: text('checked_in_device'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tickets_serial_key').on(t.serial),
    index('tickets_event_idx').on(t.eventId),
    index('tickets_order_idx').on(t.orderId),
  ],
);

export const checkinLogs = pgTable(
  'checkin_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    result: checkinResult('result').notNull(),
    /** Horodatage réel du scan sur l'appareil (peut précéder la synchronisation). */
    scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    deviceLabel: text('device_label'),
    /** Vrai si le scan a eu lieu hors ligne puis a été synchronisé après coup. */
    wasOffline: boolean('was_offline').notNull().default(false),
  },
  (t) => [index('checkin_logs_event_idx').on(t.eventId, t.scannedAt)],
);

/* -------------------------------------------------------------------------- */
/* Paiement                                                                   */
/* -------------------------------------------------------------------------- */

export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),
    status: text('status').notNull().default('created'),
    checkoutUrl: text('checkout_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payment_intents_provider_ref_key').on(t.provider, t.providerRef),
    index('payment_intents_order_idx').on(t.orderId),
  ],
);

/**
 * Journal des notifications reçues du prestataire de paiement.
 *
 * `provider_event_id` est UNIQUE : c'est toute la protection contre les
 * notifications envoyées deux fois. Une seconde insertion échoue, le traitement
 * est ignoré, et aucun second billet n'est créé.
 */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    type: text('type').notNull(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('payment_events_provider_event_key').on(t.provider, t.providerEventId)],
);

/* -------------------------------------------------------------------------- */
/* Liste d'attente                                                            */
/* -------------------------------------------------------------------------- */

export const waitlistEntries = pgTable(
  'waitlist_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    /** Null = intéressé par n'importe quelle catégorie. */
    ticketTypeId: uuid('ticket_type_id').references(() => ticketTypes.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    email: text('email').notNull(),
    quantity: integer('quantity').notNull().default(1),

    /** Rang d'arrivée : la file est traitée strictement dans cet ordre. */
    position: integer('position').notNull(),
    status: waitlistStatus('status').notNull().default('waiting'),

    /** Jeton du lien nominatif à usage unique envoyé lors d'une offre. */
    offerToken: text('offer_token'),
    offeredAt: timestamp('offered_at', { withTimezone: true }),
    offerExpiresAt: timestamp('offer_expires_at', { withTimezone: true }),
    /** Commande créée si l'offre a été acceptée. */
    convertedOrderId: uuid('converted_order_id').references(() => orders.id, {
      onDelete: 'set null',
    }),

    /**
     * Lien de désinscription, présent dans chaque e-mail.
     *
     * Sans lui, quelqu'un d'inscrit par erreur n'a aucun moyen de sortir de la
     * file et continuera de recevoir des offres.
     *
     * La valeur par défaut est calculée par PostgreSQL : elle rend la migration
     * sûre sur une base contenant déjà des inscriptions, qui recevront chacune
     * un jeton distinct au lieu de faire échouer la contrainte. L'application,
     * elle, fournit toujours un jeton de 32 octets (voir `joinWaitlist`).
     */
    unsubscribeToken: text('unsubscribe_token')
      .notNull()
      .default(sql`replace(gen_random_uuid()::text, '-', '')`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('waitlist_event_status_idx').on(t.eventId, t.status, t.position),
    index('waitlist_offer_expiry_idx').on(t.status, t.offerExpiresAt),
    uniqueIndex('waitlist_offer_token_key').on(t.offerToken),
  ],
);

/* -------------------------------------------------------------------------- */
/* File d'envoi des e-mails                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Les e-mails ne sont jamais envoyés directement depuis une requête HTTP : ils
 * sont déposés ici dans la même transaction que l'action métier, puis envoyés
 * par le worker. Un envoi qui échoue est réessayé au lieu d'être perdu.
 */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    toEmail: text('to_email').notNull(),
    template: text('template').notNull(),
    payload: jsonb('payload').notNull(),
    status: outboxStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('email_outbox_pending_idx').on(t.status, t.availableAt)],
);

/* -------------------------------------------------------------------------- */
/* Sécurité                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Compteurs de limitation de débit, en fenêtre fixe.
 *
 * Stockés en base plutôt qu'en mémoire : un compteur en mémoire disparaîtrait à
 * chaque redéploiement et ne serait pas partagé entre plusieurs instances — donc
 * contournable en attendant, ou en visant un autre serveur.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    /** Ex. `login:ip:203.0.113.4` ou `hold:email:camille@…`. */
    bucket: text('bucket').notNull(),
    /** Début de la fenêtre, tronqué à la durée choisie. */
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('rate_limits_key').on(t.bucket, t.windowStart),
    index('rate_limits_expiry_idx').on(t.expiresAt),
  ],
);

/**
 * Suivi des échecs de connexion, pour le verrouillage temporaire de compte.
 *
 * Distinct de la limitation de débit : celle-ci plafonne le rythme, celui-ci
 * bloque une cible précise après N échecs, avec un délai qui double à chaque
 * série. Les deux sont nécessaires — un attaquant lent passe sous le seuil de
 * débit mais reste arrêté par le verrouillage.
 */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    /** Adresse e-mail visée, ou `ip:<adresse>`. */
    identifier: text('identifier').primaryKey(),
    failures: integer('failures').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('login_attempts_locked_idx').on(t.lockedUntil)],
);

/**
 * Journal des actions sensibles.
 *
 * Répond à une question qui finit toujours par se poser : « qui a annulé cette
 * commande ? ». Sans trace, la réponse est une discussion ; avec, c'est un fait.
 * Le journal est en ajout seul — aucune fonction de l'application ne le modifie
 * ni ne le supprime.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    /** Null pour une action venant du public ou du système. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata').notNull().default({}),
    /** Adresse tronquée : suffisante pour corréler, sans conserver un identifiant complet. */
    ipPrefix: text('ip_prefix'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_org_idx').on(t.organizationId, t.createdAt),
    index('audit_log_target_idx').on(t.targetType, t.targetId),
  ],
);

/* -------------------------------------------------------------------------- */

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Event = typeof events.$inferSelect;
export type TicketType = typeof ticketTypes.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type WaitlistEntry = typeof waitlistEntries.$inferSelect;
