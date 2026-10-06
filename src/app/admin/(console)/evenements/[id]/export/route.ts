import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { events } from '@/db/schema';
import { exportAttendeesCsv } from '@/server/reporting';
import { requireApiUser } from '@/lib/api-auth';
import { clientIp, userAgent } from '@/lib/security/request';
import { anonymizeIp } from '@/lib/security/config';
import * as audit from '@/lib/security/audit';

/**
 * Export CSV de la liste des participants, pour le lieu.
 *
 * C'est une **liste nominative complète** qui quitte le système : noms, adresses
 * e-mail, téléphones. Deux conséquences :
 *
 *  • le droit `participants.exporter` est exigé — un compte « poste d'entrée »
 *    n'a aucune raison de pouvoir aspirer le fichier clients ;
 *  • chaque export est journalisé, avec l'auteur et le nombre de lignes. Si ce
 *    fichier se retrouve un jour là où il ne devrait pas, on saura d'où il vient.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser('participants.exporter');
  if (!auth.ok) return new Response(auth.error, { status: auth.status });

  const user = auth.data;
  const { id } = await params;

  const csv = await exportAttendeesCsv(user.organizationId, id);
  if (csv === null) return new Response('Événement introuvable', { status: 404 });

  const [event] = await db
    .select({ slug: events.slug })
    .from(events)
    .where(and(eq(events.id, id), eq(events.organizationId, user.organizationId)))
    .limit(1);

  await audit.record({
    action: 'export.participants',
    organizationId: user.organizationId,
    userId: user.id,
    targetType: 'event',
    targetId: id,
    // Le décompte des lignes suffit à détecter un export anormal ; le contenu,
    // lui, n'a évidemment rien à faire dans un journal.
    metadata: { lignes: csv.split('\r\n').length - 1 },
    ipPrefix: anonymizeIp(clientIp(request)),
    userAgent: userAgent(request),
  });

  const filename = `participants-${event?.slug ?? id}.csv`;

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
    },
  });
}
