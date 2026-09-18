import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { db } from '@/db';
import { events, ticketTypes, waitlistEntries } from '@/db/schema';
import { getOrderDetail } from '@/server/orders';
import { buildTicketToken } from '@/lib/qr';
import { formatCents } from '@/lib/money';
import { formatWithViewerZone, formatCountdown } from '@/lib/dates';
import type { EmailTemplate } from '@/server/outbox';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer; cid: string }[];
  /** En-têtes supplémentaires, notamment `List-Unsubscribe`. */
  headers?: Record<string, string>;
}

/**
 * Bloc de pied d'e-mail portant le lien de désinscription.
 *
 * Présent sur tous les messages de liste d'attente : un destinataire doit
 * toujours pouvoir sortir en un clic. C'est aussi ce que réclament les filtres
 * anti-spam — un envoi sans issue de secours finit en indésirable, et un billet
 * en indésirable est un client à l'entrée sans billet.
 */
function unsubscribeFooter(token: string): string {
  return `<p style="margin:20px 0 0;font-size:12px;color:#a8a29e;line-height:1.6;">
Vous ne souhaitez plus être prévenu·e&nbsp;?
<a href="${esc(`${APP_URL}/liste-attente/desinscription/${token}`)}" style="color:#78716c;">Quitter la liste d'attente</a>.
</p>`;
}

/**
 * En-têtes de désinscription normalisés.
 *
 * `List-Unsubscribe-Post` permet aux messageries d'afficher leur propre bouton
 * « se désabonner », ce qui évite que les gens signalent le message comme spam
 * faute de trouver le lien.
 */
function unsubscribeHeaders(token: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${APP_URL}/liste-attente/desinscription/${token}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/* -------------------------------------------------------------------------- */
/* Mise en page commune                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Gabarit en tableaux et styles en ligne : c'est la seule mise en page que les
 * clients de messagerie rendent de façon fiable.
 */
function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1917;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
<tr><td style="background:#1c1917;padding:20px 28px;">
<div style="color:#fafaf9;font-size:15px;font-weight:600;letter-spacing:.02em;">Les Nuits de la Garonne</div>
</td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 18px;font-size:20px;line-height:1.3;font-weight:600;">${esc(title)}</h1>
${body}
</td></tr>
<tr><td style="padding:18px 28px;background:#fafaf9;border-top:1px solid #e7e5e4;color:#78716c;font-size:12px;line-height:1.6;">
Une question ? Répondez simplement à cet e-mail.
</td></tr>
</table></td></tr></table></body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr>
<td style="background:#1c1917;border-radius:9px;">
<a href="${esc(href)}" style="display:inline-block;padding:13px 24px;color:#fafaf9;text-decoration:none;font-weight:600;font-size:15px;">${esc(label)}</a>
</td></tr></table>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#44403c;">${text}</p>`;
}

function infoBox(rows: [string, string][]): string {
  const cells = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:5px 0;color:#78716c;font-size:14px;">${esc(k)}</td>
<td style="padding:5px 0;text-align:right;font-size:14px;font-weight:600;">${esc(v)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:10px;padding:14px 16px;margin:18px 0;">${cells}</table>`;
}

/* -------------------------------------------------------------------------- */
/* Rendu                                                                      */
/* -------------------------------------------------------------------------- */

export async function renderEmail(
  template: EmailTemplate,
  payload: Record<string, unknown>,
): Promise<RenderedEmail | null> {
  switch (template) {
    case 'order_pending':
      return renderOrderPending(String(payload.orderId));
    case 'order_confirmed':
      return renderOrderConfirmed(String(payload.orderId));
    case 'order_reminder':
      return renderOrderReminder(String(payload.orderId));
    case 'order_expired':
      return renderOrderExpired(String(payload.orderId));
    case 'order_cancelled':
      return renderOrderCancelled(String(payload.orderId), Boolean(payload.wasPaid));
    case 'waitlist_registered':
      return renderWaitlistRegistered(
        String(payload.eventId),
        Number(payload.position),
        String(payload.unsubscribeToken ?? ''),
      );
    case 'waitlist_offer':
      return renderWaitlistOffer(payload);
    case 'waitlist_offer_expired':
      return renderWaitlistOfferExpired(String(payload.eventId));
    default:
      return null;
  }
}

/* --- Commandes ------------------------------------------------------------ */

async function renderOrderPending(orderId: string): Promise<RenderedEmail | null> {
  const detail = await getOrderDetail(db, { orderId });
  if (!detail) return null;
  const { order, event } = detail;

  const when = formatWithViewerZone(event.startsAt, event.timezone, order.customerTimezone);
  const deadline = order.holdExpiresAt
    ? formatWithViewerZone(order.holdExpiresAt, event.timezone, order.customerTimezone).primary
    : null;

  const body =
    p(`Bonjour ${esc(order.customerName)},`) +
    p(
      `Vos places pour <strong>${esc(event.title)}</strong> sont réservées. Elles vous sont gardées jusqu'au paiement.`,
    ) +
    infoBox([
      ['Référence', order.reference],
      ['Date', when.primary],
      ['Total', formatCents(order.totalCents, order.currency)],
      ...(deadline ? ([['À régler avant', deadline]] as [string, string][]) : []),
    ]) +
    p(
      order.paymentMethod === 'transfer'
        ? `Le virement peut prendre un peu de temps : vos places restent bloquées jusqu'à la date indiquée.`
        : `Sans règlement avant cette échéance, les places repartent à la vente.`,
    ) +
    button(`${APP_URL}/commande/${order.manageToken}`, 'Régler ma réservation');

  return {
    subject: `Réservation ${order.reference} — ${event.title}`,
    html: layout('Votre réservation est enregistrée', body),
    text: `Réservation ${order.reference} pour ${event.title}. Total ${formatCents(order.totalCents)}. Régler : ${APP_URL}/commande/${order.manageToken}`,
  };
}

async function renderOrderConfirmed(orderId: string): Promise<RenderedEmail | null> {
  const detail = await getOrderDetail(db, { orderId });
  if (!detail) return null;
  const { order, event, tickets: ticketRows } = detail;

  const when = formatWithViewerZone(event.startsAt, event.timezone, order.customerTimezone);

  // Un QR par billet, attaché en image intégrée : lisible même sans réseau à
  // l'entrée de la salle.
  const attachments: RenderedEmail['attachments'] = [];
  const blocks: string[] = [];

  for (const [i, t] of ticketRows.entries()) {
    const cid = `qr${i}@nuits`;
    const png = await QRCode.toBuffer(buildTicketToken(t.id), {
      width: 320,
      margin: 1,
      errorCorrectionLevel: 'M',
    });
    attachments.push({ filename: `${t.serial}.png`, content: png, cid });

    blocks.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
style="border:1px solid #e7e5e4;border-radius:12px;margin:0 0 14px;">
<tr><td style="padding:18px;text-align:center;">
<div style="font-size:13px;color:#78716c;text-transform:uppercase;letter-spacing:.06em;">${esc(t.ticketTypeName)}</div>
<div style="font-size:17px;font-weight:600;margin:4px 0 12px;">${esc(t.holderName)}</div>
<img src="cid:${cid}" width="180" height="180" alt="QR ${esc(t.serial)}" style="display:block;margin:0 auto;border-radius:8px;">
<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#57534e;margin-top:10px;">${esc(t.serial)}</div>
</td></tr></table>`,
    );
  }

  const location = event.isOnline
    ? 'Événement en ligne — le lien vous sera envoyé avant le début'
    : `${event.venueName ?? ''}${event.venueAddress ? `, ${event.venueAddress}` : ''}`;

  const body =
    p(`Bonjour ${esc(order.customerName)},`) +
    p(`Votre paiement est bien reçu. Voici vos billets pour <strong>${esc(event.title)}</strong>.`) +
    infoBox([
      ['Référence', order.reference],
      ['Date', when.primary],
      ...(when.secondary ? ([['Chez vous', when.secondary]] as [string, string][]) : []),
      ['Lieu', location],
      ['Total réglé', formatCents(order.totalCents, order.currency)],
    ]) +
    blocks.join('') +
    p(`Présentez ces QR codes à l'entrée. Chaque billet n'est valable qu'une seule fois.`) +
    button(`${APP_URL}/commande/${order.manageToken}`, 'Voir mes billets en ligne');

  return {
    subject: `Vos billets — ${event.title}`,
    html: layout('Vos billets sont prêts', body),
    text: `Billets pour ${event.title} (${order.reference}) : ${APP_URL}/commande/${order.manageToken}`,
    attachments,
  };
}

async function renderOrderReminder(orderId: string): Promise<RenderedEmail | null> {
  const detail = await getOrderDetail(db, { orderId });
  if (!detail || detail.order.status !== 'pending') return null;
  const { order, event } = detail;

  const remaining = order.holdExpiresAt
    ? formatCountdown(order.holdExpiresAt.getTime() - Date.now())
    : '';

  const body =
    p(`Bonjour ${esc(order.customerName)},`) +
    p(
      `Votre réservation pour <strong>${esc(event.title)}</strong> n'est pas encore réglée. Il vous reste environ <strong>${esc(remaining)}</strong> avant que les places ne repartent à la vente.`,
    ) +
    infoBox([
      ['Référence', order.reference],
      ['Total', formatCents(order.totalCents, order.currency)],
    ]) +
    button(`${APP_URL}/commande/${order.manageToken}`, 'Régler maintenant');

  return {
    subject: `Votre réservation ${order.reference} expire bientôt`,
    html: layout('Pensez à régler votre réservation', body),
    text: `Réservation ${order.reference} : il reste ${remaining}. ${APP_URL}/commande/${order.manageToken}`,
  };
}

async function renderOrderExpired(orderId: string): Promise<RenderedEmail | null> {
  const detail = await getOrderDetail(db, { orderId });
  if (!detail) return null;
  const { order, event } = detail;

  const body =
    p(`Bonjour ${esc(order.customerName)},`) +
    p(
      `Faute de règlement, votre réservation <strong>${esc(order.reference)}</strong> pour ${esc(event.title)} a expiré et les places sont reparties à la vente.`,
    ) +
    p(`S'il en reste, vous pouvez en reprendre à tout moment.`) +
    button(`${APP_URL}/e/${event.slug}`, "Revoir l'événement");

  return {
    subject: `Réservation ${order.reference} expirée`,
    html: layout('Votre réservation a expiré', body),
    text: `La réservation ${order.reference} a expiré. ${APP_URL}/e/${event.slug}`,
  };
}

async function renderOrderCancelled(
  orderId: string,
  wasPaid: boolean,
): Promise<RenderedEmail | null> {
  const detail = await getOrderDetail(db, { orderId });
  if (!detail) return null;
  const { order, event } = detail;

  const body =
    p(`Bonjour ${esc(order.customerName)},`) +
    p(`Votre commande <strong>${esc(order.reference)}</strong> pour ${esc(event.title)} est annulée.`) +
    (wasPaid
      ? p(
          `Le remboursement de ${esc(formatCents(order.totalCents, order.currency))} est en cours de traitement.`,
        )
      : p(`Aucun montant n'a été débité.`)) +
    p(`Vos billets ne sont plus valables à l'entrée.`);

  return {
    subject: `Annulation de la commande ${order.reference}`,
    html: layout('Commande annulée', body),
    text: `Commande ${order.reference} annulée.`,
  };
}

/* --- Liste d'attente ------------------------------------------------------ */

async function renderWaitlistRegistered(
  eventId: string,
  position: number,
  unsubscribeToken: string,
): Promise<RenderedEmail | null> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return null;

  const body =
    p(`Bonjour,`) +
    p(
      `Vous êtes inscrit·e sur la liste d'attente de <strong>${esc(event.title)}</strong>. Vous êtes en position <strong>n° ${position}</strong>.`,
    ) +
    p(
      `Dès qu'une place se libère, elle est proposée aux inscrits dans l'ordre d'arrivée. Vous recevrez un e-mail avec un lien personnel et un délai pour confirmer.`,
    ) +
    unsubscribeFooter(unsubscribeToken);

  return {
    subject: `Liste d'attente — ${event.title}`,
    html: layout("Vous êtes sur la liste d'attente", body),
    text: `Inscription en liste d'attente pour ${event.title}, position ${position}. Se désinscrire : ${APP_URL}/liste-attente/desinscription/${unsubscribeToken}`,
    headers: unsubscribeHeaders(unsubscribeToken),
  };
}

async function renderWaitlistOffer(
  payload: Record<string, unknown>,
): Promise<RenderedEmail | null> {
  const [entry] = await db
    .select()
    .from(waitlistEntries)
    .where(eq(waitlistEntries.id, String(payload.entryId)))
    .limit(1);
  if (!entry) return null;

  const [event] = await db.select().from(events).where(eq(events.id, entry.eventId)).limit(1);
  if (!event) return null;

  const [type] = await db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.id, entry.ticketTypeId ?? ''))
    .limit(1);

  const expiresAt = new Date(String(payload.offerExpiresAt));
  const when = formatWithViewerZone(expiresAt, event.timezone, null);

  const body =
    p(`Bonjour ${esc(entry.name)},`) +
    p(
      `Une place vient de se libérer pour <strong>${esc(event.title)}</strong>, et c'est votre tour.`,
    ) +
    infoBox([
      ['Catégorie', type?.name ?? '—'],
      ['Quantité', String(entry.quantity)],
      ['À confirmer avant', when.primary],
    ]) +
    p(
      `<strong>Ces places vous sont réservées</strong> jusqu'à cette échéance — personne d'autre ne peut les prendre entre-temps. Passé ce délai, elles seront proposées à la personne suivante.`,
    ) +
    button(`${APP_URL}/liste-attente/${payload.offerToken}`, 'Confirmer ma place') +
    unsubscribeFooter(entry.unsubscribeToken);

  return {
    subject: `Une place se libère — ${event.title}`,
    html: layout('Votre tour est arrivé', body),
    text: `Une place se libère pour ${event.title}. Confirmez avant ${when.primary} : ${APP_URL}/liste-attente/${payload.offerToken}`,
    headers: unsubscribeHeaders(entry.unsubscribeToken),
  };
}

async function renderWaitlistOfferExpired(eventId: string): Promise<RenderedEmail | null> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return null;

  const body =
    p(`Bonjour,`) +
    p(
      `Le délai pour confirmer votre place sur <strong>${esc(event.title)}</strong> est passé, elle a été proposée à la personne suivante.`,
    ) +
    p(`Vous pouvez vous réinscrire sur la liste d'attente si vous le souhaitez.`) +
    button(`${APP_URL}/e/${event.slug}`, "Revoir l'événement");

  return {
    subject: `Délai dépassé — ${event.title}`,
    html: layout('Le délai est passé', body),
    text: `Le délai de confirmation est dépassé pour ${event.title}.`,
  };
}
