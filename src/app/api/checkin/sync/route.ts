import { NextResponse } from 'next/server';
import { syncOfflineScans } from '@/server/checkin';
import { guardOrigin, requireApiEvent } from '@/lib/api-auth';
import { offlineScanSchema } from '@/lib/validation';
import { consume, tooManyRequests } from '@/lib/security/rate-limit';
import { payloadTooLarge, PayloadTooLargeError, readJsonBody } from '@/lib/security/request';

/**
 * Synchronisation des scans effectués hors ligne.
 *
 * Le corps peut légitimement peser : jusqu'à deux mille scans après une longue
 * coupure. Le plafond est donc plus large qu'ailleurs — 512 ko — mais reste
 * explicite, faute de quoi cette route serait le point d'entrée idéal pour
 * saturer la mémoire du serveur.
 */
export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  let payload: unknown;
  try {
    payload = await readJsonBody(request, 512 * 1024);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return payloadTooLarge();
    return NextResponse.json({ error: 'Requête illisible.' }, { status: 400 });
  }

  const parsed = offlineScanSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides.' }, { status: 400 });
  }

  const auth = await requireApiEvent(parsed.data.eventId, 'billets.scanner');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const limit = await consume('sync', `event:${parsed.data.eventId}`);
  if (!limit.allowed) return tooManyRequests(limit);

  const report = await syncOfflineScans(
    parsed.data.eventId,
    parsed.data.scans,
    auth.data.user.id,
  );

  return NextResponse.json(report);
}
