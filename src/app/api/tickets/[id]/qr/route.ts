import { and, eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { db } from '@/db';
import { orders, tickets } from '@/db/schema';
import { buildTicketToken } from '@/lib/qr';
import { consume } from '@/lib/security/rate-limit';
import { clientIp } from '@/lib/security/request';

/**
 * Image QR d'un billet.
 *
 * L'accès exige **deux** éléments : l'identifiant du billet *et* le jeton de
 * gestion de la commande qui le contient.
 *
 * Auparavant l'identifiant seul suffisait. Un UUID aléatoire n'est certes pas
 * devinable, mais il circule : dans l'historique du navigateur, dans les
 * journaux d'un intermédiaire, dans une capture d'écran de la page. Exiger le
 * jeton en plus lie l'image à la commande et élimine toute la catégorie des
 * fuites par identifiant isolé.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response('Identifiant invalide', { status: 400 });
  }

  const manageToken = new URL(request.url).searchParams.get('t');
  if (!manageToken || manageToken.length < 20) {
    return new Response('Accès non autorisé', { status: 401 });
  }

  // Borne le tâtonnement, même si l'espace de recherche le rend déjà illusoire.
  const limit = await consume('orderView', `qr:${clientIp(request)}`);
  if (!limit.allowed) {
    return new Response('Trop de requêtes', {
      status: 429,
      headers: { 'retry-after': String(limit.retryAfter) },
    });
  }

  // Le jeton entre dans la condition SQL : le billet doit appartenir à cette
  // commande précise, pas seulement exister.
  const [ticket] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .where(
      and(
        eq(tickets.id, id),
        eq(orders.manageToken, manageToken),
        eq(tickets.status, 'valid'),
        eq(orders.status, 'paid'),
      ),
    )
    .limit(1);

  // Même réponse que le billet soit inconnu ou le jeton faux : rien à apprendre
  // en comparant les deux cas.
  if (!ticket) return new Response('Billet introuvable', { status: 404 });

  const png = await QRCode.toBuffer(buildTicketToken(ticket.id), {
    width: 400,
    margin: 1,
    errorCorrectionLevel: 'M',
  });

  return new Response(new Uint8Array(png), {
    headers: {
      'content-type': 'image/png',
      // Cache privé : le billet reste affichable sans réseau devant la salle,
      // mais aucun intermédiaire n'a le droit d'en garder copie.
      'cache-control': 'private, max-age=86400, no-transform',
      'x-content-type-options': 'nosniff',
    },
  });
}
