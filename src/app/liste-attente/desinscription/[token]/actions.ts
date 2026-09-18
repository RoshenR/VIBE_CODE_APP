'use server';

import { unsubscribe } from '@/server/waitlist';
import { consume } from '@/lib/security/rate-limit';

export async function unsubscribeAction(token: string): Promise<{ ok: boolean }> {
  // Le jeton est aléatoire sur 32 octets ; la limite borne malgré tout le
  // tâtonnement, et surtout l'usage de cette route comme amplificateur.
  const limit = await consume('cancel', `desinscription:${token.slice(0, 8)}`);
  if (!limit.allowed) return { ok: false };

  const result = await unsubscribe(token);
  return { ok: result.ok };
}
