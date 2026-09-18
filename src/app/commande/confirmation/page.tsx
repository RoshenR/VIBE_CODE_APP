import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders } from '@/db/schema';

/**
 * Point de retour depuis le prestataire de paiement.
 *
 * Le client revient ici avec l'identifiant de commande dans l'URL ; on le
 * redirige vers sa page de gestion, dont le jeton n'a pas à transiter par le
 * prestataire.
 *
 * La commande n'est pas forcément encore confirmée à cet instant : c'est la
 * notification serveur qui fait foi, pas le retour du navigateur. Un client qui
 * ferme son onglet trop tôt reçoit quand même ses billets.
 */
export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order: orderId } = await searchParams;
  if (!orderId) redirect('/');

  const [order] = await db
    .select({ manageToken: orders.manageToken })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  redirect(order ? `/commande/${order.manageToken}` : '/');
}
