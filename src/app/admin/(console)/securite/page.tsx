import type { Metadata } from 'next';
import { Laptop, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/states';
import { listSessions } from '@/lib/auth';
import { formatShort } from '@/lib/dates';
import { requireUser } from '@/lib/org';
import { ROLE_LABELS } from '@/lib/permissions';
import { TotpPanel } from './totp-panel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sécurité du compte' };

export default async function SecurityPage() {
  const user = await requireUser();
  const sessions = await listSessions(user.id);

  return (
    <div className="max-w-3xl">
      <p className="eyebrow text-copper-ink">{user.organizationName}</p>
      <h1 className="display text-display-lg mt-1">Sécurité du compte</h1>
      <p className="text-ink-soft mt-2">
        {user.name} · {user.email} · {ROLE_LABELS[user.role]}
      </p>

      <section
        aria-labelledby="totp-titre"
        className="border-rule bg-paper shadow-panel mt-8 rounded-panel border p-5 sm:p-7"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="totp-titre" className="display text-display-md">
              Double authentification
            </h2>
            <p className="text-ink-soft measure mt-2">
              Un code à six chiffres demandé à chaque connexion, en plus du mot de passe. C&apos;est la
              seule protection qui tienne si votre mot de passe fuite : par un autre site, un
              ordinateur partagé ou un message d&apos;hameçonnage.
            </p>
          </div>
          {user.totpEnabled ? (
            <StatusBadge tone="success" icon={ShieldCheck}>
              Activée
            </StatusBadge>
          ) : (
            <StatusBadge tone="warning" icon={ShieldOff}>
              Non activée
            </StatusBadge>
          )}
        </div>

        <TotpPanel enabled={user.totpEnabled} />
      </section>

      <section aria-labelledby="sessions-titre" className="mt-10">
        <h2 id="sessions-titre" className="display text-display-md">
          Sessions actives
        </h2>
        <p className="text-ink-soft measure mt-2">
          Les appareils actuellement connectés à ce compte. Une session se ferme d&apos;elle-même après
          12 h d&apos;inactivité, et dans tous les cas au bout de 7 jours.
        </p>

        {sessions.length === 0 ? (
          <div className="mt-5">
            <EmptyState icon={Laptop} title="Aucune session active" />
          </div>
        ) : (
          <ul className="mt-5 space-y-3">
            {sessions.map((session, i) => {
              const mobile = /iPhone|iPad|Android/i.test(session.userAgent ?? '');
              const Icon = mobile ? Smartphone : Laptop;
              return (
                <li
                  key={i}
                  className="border-rule bg-paper flex items-center gap-4 rounded-panel border p-4"
                >
                  <span className="bg-sunken text-ink grid size-11 shrink-0 place-items-center rounded-control">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{describeDevice(session.userAgent)}</p>
                    <p className="text-ink-muted text-sm">
                      {session.ipPrefix ?? 'origine inconnue'} · vue{' '}
                      {formatShort(session.lastSeenAt, user.organizationTimezone)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Description lisible d'un appareil. Volontairement grossière : il s'agit de
 * reconnaître « mon téléphone » ou « le portable du local », pas de dresser un
 * profil technique.
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
