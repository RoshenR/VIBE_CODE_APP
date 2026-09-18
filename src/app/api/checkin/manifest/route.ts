import { NextResponse } from 'next/server';
import { buildManifest } from '@/server/checkin';
import { requireApiEvent } from '@/lib/api-auth';
import { clientIp, userAgent } from '@/lib/security/request';
import { anonymizeIp } from '@/lib/security/config';
import * as audit from '@/lib/security/audit';

/**
 * Manifeste des billets, téléchargé par les appareils de l'équipe avant
 * l'ouverture des portes.
 *
 * Il ne contient que des empreintes de jetons — un appareil perdu ne permet pas
 * de fabriquer des billets — mais il livre bien la **liste nominative** des
 * participants. C'est une donnée personnelle : chaque téléchargement est donc
 * journalisé, avec l'appareil et l'heure.
 */
export async function GET(request: Request) {
  const eventId = new URL(request.url).searchParams.get('eventId');
  if (!eventId) {
    return NextResponse.json({ error: 'Événement manquant.' }, { status: 400 });
  }

  const auth = await requireApiEvent(eventId, 'billets.scanner');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const manifest = await buildManifest(eventId);

  await audit.record({
    action: 'billets.manifeste_telecharge',
    organizationId: auth.data.user.organizationId,
    userId: auth.data.user.id,
    targetType: 'event',
    targetId: eventId,
    metadata: { billets: manifest.entries.length },
    ipPrefix: anonymizeIp(clientIp(request)),
    userAgent: userAgent(request),
  });

  return NextResponse.json(
    { ...manifest, eventTitle: auth.data.event.title },
    {
      headers: {
        // Jamais de cache : ni navigateur, ni intermédiaire. C'est une liste
        // nominative, elle ne doit pas rester sur un disque au hasard.
        'cache-control': 'no-store, private',
      },
    },
  );
}
