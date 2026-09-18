import { NextResponse } from 'next/server';
import { validateScan } from '@/server/checkin';
import { guardOrigin, requireApiEvent } from '@/lib/api-auth';
import { scanSchema } from '@/lib/validation';
import { consume, tooManyRequests } from '@/lib/security/rate-limit';
import { payloadTooLarge, PayloadTooLargeError, readJsonBody } from '@/lib/security/request';

/**
 * Validation d'un billet quand le réseau est disponible.
 *
 * La limite de débit est haute (600 par minute) : devant une file d'attente, les
 * scans s'enchaînent légitimement. Elle n'est pas là pour freiner l'équipe mais
 * pour empêcher un compte compromis de balayer des jetons à l'aveugle.
 */
export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  let payload: unknown;
  try {
    payload = await readJsonBody(request, 8 * 1024);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return payloadTooLarge();
    return NextResponse.json({ error: 'Requête illisible.' }, { status: 400 });
  }

  const parsed = scanSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides.' }, { status: 400 });
  }

  // Le rôle `scanner` suffit — c'est précisément ce que ce rôle existe pour faire.
  const auth = await requireApiEvent(parsed.data.eventId, 'billets.scanner');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const limit = await consume('scan', `event:${parsed.data.eventId}`);
  if (!limit.allowed) return tooManyRequests(limit);

  const outcome = await validateScan({
    token: parsed.data.token,
    eventId: parsed.data.eventId,
    userId: auth.data.user.id,
    deviceLabel: parsed.data.deviceLabel ?? null,
  });

  return NextResponse.json(outcome);
}
