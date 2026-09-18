import { NextResponse } from 'next/server';
import { joinWaitlist } from '@/server/waitlist';
import { joinWaitlistSchema } from '@/lib/validation';
import { guardOrigin } from '@/lib/api-auth';
import { consumeAll, tooManyRequests } from '@/lib/security/rate-limit';
import {
  clientIp,
  looksAutomated,
  payloadTooLarge,
  PayloadTooLargeError,
  readJsonBody,
} from '@/lib/security/request';

export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  let payload: Record<string, unknown>;
  try {
    payload = await readJsonBody<Record<string, unknown>>(request);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return payloadTooLarge();
    return NextResponse.json({ error: 'Requête illisible.' }, { status: 400 });
  }

  if (looksAutomated(payload)) {
    // Réponse plausible : le robot croit avoir réussi et cesse d'insister.
    return NextResponse.json({ position: 1, alreadyRegistered: false });
  }

  const parsed = joinWaitlistSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Données invalides.' },
      { status: 400 },
    );
  }

  const limit = await consumeAll([
    { rule: 'waitlist', identifier: `ip:${clientIp(request)}` },
    { rule: 'waitlist', identifier: `email:${parsed.data.email}` },
  ]);
  if (!limit.allowed) return tooManyRequests(limit);

  try {
    const result = await joinWaitlist(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Échec d'inscription en liste d'attente", err);
    return NextResponse.json({ error: 'Inscription impossible.' }, { status: 500 });
  }
}
