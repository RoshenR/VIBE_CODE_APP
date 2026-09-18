import { NextResponse } from 'next/server';
import { getPaymentProvider, handleWebhookEvent } from '@/server/payments';
import { consume, tooManyRequests } from '@/lib/security/rate-limit';
import { clientIp } from '@/lib/security/request';

/** Un événement de paiement dépasse rarement quelques kilo-octets. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Réception des notifications du prestataire de paiement.
 *
 * Route publique par nécessité — elle est appelée par un serveur tiers, donc
 * **sans** contrôle d'origine, contrairement à toutes les autres routes POST.
 * Ce qui l'authentifie, c'est la signature du corps.
 *
 * Règles appliquées :
 *
 *  • le corps brut est lu tel quel : la signature porte sur les octets exacts,
 *    un `JSON.parse` suivi d'un `stringify` la casserait ;
 *  • taille plafonnée avant toute analyse ;
 *  • signature vérifiée **avant** le moindre traitement ;
 *  • un rejeu répond `200` — un 4xx ferait réessayer le prestataire en boucle
 *    alors que tout va bien ;
 *  • le traitement lui-même est idempotent (`server/payments/index.ts`).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerName } = await params;
  const provider = getPaymentProvider();

  if (providerName !== provider.name) {
    return NextResponse.json({ error: 'Prestataire inconnu.' }, { status: 404 });
  }

  // Plafond généreux mais réel : sans lui, cette route publique serait le point
  // d'entrée le plus simple pour saturer la mémoire du serveur.
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Charge utile trop volumineuse.' }, { status: 413 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Charge utile trop volumineuse.' }, { status: 413 });
  }

  // Compteur large : le prestataire a le droit de réessayer, mais pas de nous
  // noyer si son système part en boucle.
  const limit = await consume('webhook', `ip:${clientIp(request)}`);
  if (!limit.allowed) return tooManyRequests(limit);

  if (!provider.verifyWebhook(rawBody, request.headers)) {
    // Journalisé sans le corps : une charge utile non authentifiée est une
    // donnée hostile, elle n'a pas sa place dans les journaux.
    console.warn('[sécurité] notification de paiement rejetée : signature invalide');
    return NextResponse.json({ error: 'Signature invalide.' }, { status: 401 });
  }

  let event;
  try {
    event = provider.parseEvent(rawBody);
  } catch {
    return NextResponse.json({ error: 'Charge utile illisible.' }, { status: 400 });
  }

  try {
    const outcome = await handleWebhookEvent(event);

    if (outcome.status === 'needs_refund') {
      console.error(
        `Paiement tardif non servable — commande ${outcome.orderId} à rembourser`,
      );
    }

    return NextResponse.json({ received: true, status: outcome.status });
  } catch (err) {
    console.error('Échec de traitement du webhook', err);
    // 500 : ici, une nouvelle tentative du prestataire est souhaitable.
    return NextResponse.json({ error: 'Traitement impossible.' }, { status: 500 });
  }
}
