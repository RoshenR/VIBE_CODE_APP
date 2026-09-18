import Link from 'next/link';
import { requireUser } from '@/lib/org';
import { listSessions } from '@/lib/auth';
import { formatShort } from '@/lib/dates';
import { Badge } from '@/app/_components/chrome';
import { TotpPanel } from './totp-panel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sécurité du compte' };

export default async function SecurityPage() {
  const user = await requireUser();
  const sessions = await listSessions(user.id);

  return (
    <div>
      <Link href="/admin" className="text-ink-500 hover:text-ink-800 text-sm">
        ← Tableau de bord
      </Link>
      <h1 className="text-ink-900 mt-1 text-xl font-semibold tracking-tight">
        Sécurité du compte
      </h1>
      <p className="text-ink-500 mt-1 text-sm">
        {user.email} · rôle {roleLabel(user.role)}
      </p>

      <section className="border-ink-200 mt-6 rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-ink-900 font-semibold">Double authentification</h2>
            <p className="text-ink-500 mt-1 max-w-prose text-sm">
              Un code à six chiffres demandé à chaque connexion, en plus du mot de
              passe. C&apos;est la seule protection qui tienne si votre mot de passe
              fuite — par un autre site, un ordinateur partagé, ou un message
              d&apos;hameçonnage.
            </p>
          </div>
          <Badge tone={user.totpEnabled ? 'ok' : 'warn'}>
            {user.totpEnabled ? 'Active' : 'Inactive'}
          </Badge>
        </div>

        <TotpPanel enabled={user.totpEnabled} />
      </section>

      <section className="mt-6">
        <h2 className="text-ink-900 font-semibold">Sessions actives</h2>
        <p className="text-ink-500 mt-1 text-sm">
          Les appareils actuellement connectés à ce compte. Une session se ferme
          d&apos;elle-même après 12 h d&apos;inactivité, et dans tous les cas au bout
          de 7 jours.
        </p>

        <ul className="mt-3 space-y-2">
          {sessions.map((session, i) => (
            <li
              key={i}
              className="border-ink-200 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-4 py-3 text-sm"
            >
              <span className="text-ink-700 min-w-0 truncate">
                {describeDevice(session.userAgent)}
                <span className="text-ink-400"> · {session.ipPrefix ?? 'origine inconnue'}</span>
              </span>
              <span className="text-ink-500 shrink-0 text-xs">
                vue {formatShort(session.lastSeenAt, user.organizationTimezone)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function roleLabel(role: string): string {
  return { owner: 'responsable', staff: 'équipe', scanner: "poste d'entrée" }[role] ?? role;
}

/**
 * Description lisible d'un appareil.
 *
 * Volontairement grossière : l'objectif est de reconnaître « mon téléphone » ou
 * « le portable du local », pas de dresser un profil technique.
 */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Appareil inconnu';
  if (/iPhone|iPad/i.test(userAgent)) return 'Appareil Apple mobile';
  if (/Android/i.test(userAgent)) return 'Appareil Android';
  if (/Macintosh/i.test(userAgent)) return 'Mac';
  if (/Windows/i.test(userAgent)) return 'PC Windows';
  if (/Linux/i.test(userAgent)) return 'Ordinateur Linux';
  return 'Navigateur';
}
