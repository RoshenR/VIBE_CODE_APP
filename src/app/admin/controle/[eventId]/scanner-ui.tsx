'use client';

import { useId, useState } from 'react';
import {
  ArrowLeftRight,
  CircleCheck,
  CircleX,
  CloudOff,
  Loader2,
  TriangleAlert,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/fields';
import { cn } from '@/lib/cn';
import { formatClock } from '@/lib/dates';
import type { ManifestEntry, StoredConflict } from './manifest-store';

/* -------------------------------------------------------------------------- */
/* Verdict d'un scan                                                          */
/* -------------------------------------------------------------------------- */

/**
 * État de la synchronisation d'une validation acceptée localement.
 *
 *   syncing  — en ligne, envoi en cours ;
 *   synced   — le serveur a confirmé ;
 *   offline  — pas de réseau : la validation reste sur l'appareil ;
 *   failed   — réseau présent mais l'envoi a échoué : sera retenté.
 *
 * Seul `synced` est un succès confirmé. Les trois autres le disent en toutes
 * lettres : une absence de réponse n'est jamais présentée comme une réussite.
 */
export type SyncState = 'syncing' | 'synced' | 'offline' | 'failed';

export type Verdict =
  | { kind: 'accepted'; entry: ManifestEntry; sync: SyncState }
  | { kind: 'already'; entry: ManifestEntry; at: string; sameDevice: boolean }
  | {
      kind: 'invalid';
      /** Vrai si le serveur n'a pas pu être consulté : on ne peut alors rien affirmer. */
      offline: boolean;
      reason: 'unknown' | 'wrong_event' | 'cancelled';
    }
  | { kind: 'conflict'; conflict: StoredConflict; entry: ManifestEntry | null };

/**
 * Chaque verdict se distingue par QUATRE canaux indépendants : le mot, le
 * pictogramme, le style de bordure et le motif de fond. La couleur n'en est qu'un
 * cinquième. Il se lit donc sans le son, en niveaux de gris, et par une personne
 * daltonienne — la porte d'une salle, de nuit, n'est pas l'endroit pour deviner.
 */
export function VerdictPanel({
  verdict,
  timezone,
  onNext,
}: {
  verdict: Verdict | null;
  timezone: string;
  onNext: () => void;
}) {
  if (!verdict) {
    return (
      <div
        className="border-night-rule-strong text-on-night-muted rounded-panel border-2 border-dashed p-6 text-center"
        role="status"
      >
        <p className="font-medium">En attente d&apos;un scan</p>
        <p className="mt-1 text-sm">Le résultat s&apos;affichera ici.</p>
      </div>
    );
  }

  const at = (iso: string) => formatClock(new Date(iso), timezone);

  let tone: 'success' | 'warning' | 'danger' | 'info';
  let Icon = CircleCheck;
  let title: string;
  let border: string;
  let pattern = '';
  let body: React.ReactNode;

  switch (verdict.kind) {
    case 'accepted': {
      tone = 'success';
      Icon = CircleCheck;
      title = 'Accepté';
      // Plein = confirmé par le serveur ; tireté = pas (encore) confirmé.
      border = verdict.sync === 'synced' ? 'border-solid' : 'border-dashed';
      body = (
        <>
          <Holder entry={verdict.entry} />
          <SyncLine sync={verdict.sync} />
        </>
      );
      break;
    }
    case 'already': {
      tone = 'warning';
      Icon = TriangleAlert;
      title = 'Déjà utilisé';
      border = 'border-double';
      body = (
        <>
          <Holder entry={verdict.entry} />
          <p className="mt-3 text-[1.0625rem] font-semibold">
            Passage à {at(verdict.at)} {verdict.sameDevice ? 'sur ce poste' : 'sur un autre poste'}.
          </p>
          <p className="text-on-night-soft mt-1 text-[0.9375rem]">
            Ce billet a déjà servi : ne laissez pas entrer sans vérification.
          </p>
        </>
      );
      break;
    }
    case 'invalid': {
      tone = 'danger';
      Icon = CircleX;
      title = 'Billet invalide';
      border = 'border-solid';
      pattern =
        '[background-image:repeating-linear-gradient(135deg,rgb(255_155_143/0.14)_0_10px,transparent_10px_22px)]';
      body = verdict.offline ? (
        <>
          <p className="mt-3 text-[1.0625rem] font-semibold">
            Ce code n&apos;est pas dans la liste chargée.
          </p>
          <p className="text-on-night-soft mt-1 text-[0.9375rem]">
            Sans réseau, impossible de le vérifier auprès du serveur. Cherchez le nom ou le numéro à
            la main, ci-dessous.
          </p>
        </>
      ) : verdict.reason === 'wrong_event' ? (
        <p className="mt-3 text-[1.0625rem] font-semibold">
          Ce billet est valable pour un autre événement.
        </p>
      ) : verdict.reason === 'cancelled' ? (
        <p className="mt-3 text-[1.0625rem] font-semibold">
          Ce billet a été annulé : il n&apos;est plus valable.
        </p>
      ) : (
        <p className="mt-3 text-[1.0625rem] font-semibold">
          Ce code ne correspond à aucun billet de cette soirée.
        </p>
      );
      break;
    }
    case 'conflict': {
      tone = 'info';
      Icon = ArrowLeftRight;
      title = 'Conflit';
      border = 'border-dotted';
      body = (
        <>
          {verdict.entry && <Holder entry={verdict.entry} />}
          <p className="mt-3 text-[1.0625rem] font-semibold">
            Déjà validé à {at(verdict.conflict.firstScanAt)}
            {verdict.conflict.firstDevice ? ` sur ${verdict.conflict.firstDevice}` : ' sur un autre poste'}.
          </p>
          <p className="text-on-night-soft mt-1 text-[0.9375rem]">
            Cet appareil l&apos;avait aussi accepté, hors ligne. Une des deux personnes n&apos;aurait pas dû entrer :
            vérifiez.
          </p>
        </>
      );
      break;
    }
  }

  const palette = {
    success: 'border-success-night bg-success-night/10 text-success-night',
    warning: 'border-warning-night bg-warning-night/10 text-warning-night',
    danger: 'border-danger-night bg-danger-night/10 text-danger-night',
    info: 'border-info-night bg-info-night/10 text-info-night',
  }[tone];

  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn('rounded-panel border-[3px] p-5 sm:p-6', palette, border, pattern)}
    >
      <div className="flex items-center gap-4">
        <Icon className="size-14 shrink-0 sm:size-16" aria-hidden strokeWidth={1.75} />
        <p className="display text-display-lg leading-none">{title}</p>
      </div>
      <div className="text-on-night mt-1">{body}</div>
      <Button tone="night" variant="secondary" block className="mt-5" onClick={onNext}>
        Scanner le suivant
      </Button>
    </div>
  );
}

function Holder({ entry }: { entry: ManifestEntry }) {
  return (
    <div className="mt-4">
      <p className="text-on-night text-2xl leading-tight font-semibold">{entry.n}</p>
      <p className="text-on-night-soft mt-0.5">
        {entry.t} · <span className="font-mono text-sm">{entry.s}</span>
      </p>
    </div>
  );
}

function SyncLine({ sync }: { sync: SyncState }) {
  switch (sync) {
    case 'synced':
      return (
        <p className="text-on-night mt-3 flex items-center gap-2 text-[0.9375rem] font-semibold">
          <CircleCheck className="size-4 shrink-0" aria-hidden />
          Enregistré sur le serveur.
        </p>
      );
    case 'syncing':
      return (
        <p className="text-on-night-soft mt-3 flex items-center gap-2 text-[0.9375rem]">
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
          Enregistrement sur le serveur…
        </p>
      );
    case 'offline':
      return (
        <div className="mt-3">
          <p className="text-on-night flex items-center gap-2 text-[0.9375rem] font-semibold">
            <CloudOff className="size-4 shrink-0" aria-hidden />
            Accepté sur cet appareil — en attente de synchronisation.
          </p>
          <p className="text-on-night-soft mt-1 text-sm">
            Sans réseau, un passage déjà fait sur un autre appareil ne peut pas être détecté tout de
            suite. Le conflit éventuel apparaîtra à la synchronisation.
          </p>
        </div>
      );
    case 'failed':
      return (
        <p className="text-on-night mt-3 flex items-start gap-2 text-[0.9375rem] font-semibold">
          <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Accepté sur cet appareil — envoi au serveur impossible pour l&apos;instant.
            <span className="text-on-night-soft block font-normal">Il sera retenté automatiquement.</span>
          </span>
        </p>
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Bandeau d'état                                                             */
/* -------------------------------------------------------------------------- */

export function StatusStrip({
  online,
  queueSize,
  lastSyncIso,
  manifestCount,
  manifestAtIso,
  timezone,
}: {
  online: boolean;
  queueSize: number;
  lastSyncIso: string | null;
  manifestCount: number | null;
  manifestAtIso: string | null;
  timezone: string;
}) {
  const clock = (iso: string | null) => (iso ? formatClock(new Date(iso), timezone) : null);

  return (
    <section aria-label="État de la connexion et de la synchronisation">
      <dl className="bg-night-raised border-night-rule grid grid-cols-2 gap-px overflow-hidden rounded-panel border">
        <Cell label="Connexion">
          <span className="flex items-center gap-2 font-semibold">
            {online ? (
              <Wifi className="text-success-night size-5 shrink-0" aria-hidden />
            ) : (
              <WifiOff className="text-warning-night size-5 shrink-0" aria-hidden />
            )}
            {online ? 'En ligne' : 'Hors ligne'}
          </span>
          {!online && <span className="text-on-night-soft block text-xs">le scan fonctionne</span>}
        </Cell>

        <Cell label="À synchroniser">
          <span className="font-semibold tabular-nums">
            {queueSize === 0
              ? 'Rien en attente'
              : `${queueSize} validation${queueSize > 1 ? 's' : ''}`}
          </span>
          {queueSize > 0 && (
            <span className="text-warning-night block text-xs">pas encore envoyée{queueSize > 1 ? 's' : ''}</span>
          )}
        </Cell>

        <Cell label="Dernière synchronisation">
          <span className="font-semibold tabular-nums">
            {clock(lastSyncIso) ?? 'Aucune'}
          </span>
        </Cell>

        <Cell label="Liste des billets">
          <span className="font-semibold tabular-nums">
            {manifestCount === null ? 'Non chargée' : `${manifestCount} billets`}
          </span>
          {manifestAtIso && (
            <span className="text-on-night-soft block text-xs">chargée à {clock(manifestAtIso)}</span>
          )}
        </Cell>
      </dl>
    </section>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-night-raised p-3.5">
      <dt className="eyebrow text-on-night-muted">{label}</dt>
      <dd className="mt-1.5 text-[0.9375rem] leading-tight">{children}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Conflits                                                                   */
/* -------------------------------------------------------------------------- */

export function ConflictsPanel({
  conflicts,
  timezone,
  onDismiss,
}: {
  conflicts: StoredConflict[];
  timezone: string;
  onDismiss: (ticketId: string) => void;
}) {
  if (conflicts.length === 0) return null;
  const at = (iso: string) => formatClock(new Date(iso), timezone);

  return (
    <section
      aria-labelledby="conflits-titre"
      className="border-info-night rounded-panel border-[3px] border-dotted p-5"
    >
      <h2 id="conflits-titre" className="text-info-night flex items-center gap-2.5 text-lg font-semibold">
        <ArrowLeftRight className="size-5 shrink-0" aria-hidden />
        {conflicts.length} conflit{conflicts.length > 1 ? 's' : ''} à vérifier
      </h2>
      <p className="text-on-night-soft mt-1 text-sm">
        Billets acceptés ici hors ligne, alors qu&apos;un autre poste les avait déjà validés. À régler
        avec les personnes concernées.
      </p>

      <ul className="mt-4 space-y-3">
        {conflicts.map((c) => (
          <li key={c.ticketId} className="bg-night-raised flex items-start justify-between gap-3 rounded-control p-3.5">
            <div className="min-w-0">
              <p className="font-semibold">{c.holderName ?? 'Titulaire inconnu'}</p>
              <p className="font-mono text-sm">{c.serial}</p>
              <p className="text-on-night-soft mt-1 text-sm">
                Premier passage à {at(c.firstScanAt)}
                {c.firstDevice ? ` sur ${c.firstDevice}` : ''}
                {c.localScanAt ? ` · accepté ici à ${at(c.localScanAt)}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(c.ticketId)}
              className="hover:bg-night-high text-on-night-soft grid size-11 shrink-0 place-items-center rounded-control"
            >
              <X className="size-5" aria-hidden />
              <span className="sr-only">Écarter le conflit du billet {c.serial}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Saisie manuelle                                                            */
/* -------------------------------------------------------------------------- */

const plain = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Recherche manuelle par numéro de billet OU par nom.
 *
 * Elle n'est jamais repliée : une caméra refusée, un écran fêlé ou un QR abîmé ne
 * doivent pas faire perdre une minute à une file d'attente. Elle passe par le
 * même point de validation que la caméra (`onValidate`), donc par les mêmes règles
 * du « premier scan gagne ».
 */
export function ManualLookup({
  entries,
  localScans,
  timezone,
  onValidate,
}: {
  entries: ManifestEntry[];
  localScans: Record<string, string>;
  timezone: string;
  onValidate: (entry: ManifestEntry) => void;
}) {
  const [value, setValue] = useState('');
  const [submitted, setSubmitted] = useState('');
  const id = useId();

  const needle = plain(submitted.trim());
  const results =
    needle.length >= 2
      ? entries
          .filter((e) => plain(e.s).includes(needle) || plain(e.n).includes(needle))
          .slice(0, 8)
      : [];

  return (
    <section aria-labelledby={`${id}-titre`} className="bg-night-raised border-night-rule rounded-panel border p-5">
      <h2 id={`${id}-titre`} className="text-lg font-semibold">
        Pas de QR lisible ?
      </h2>
      <p className="text-on-night-soft mt-1 text-sm">Cherchez un numéro de billet ou un nom.</p>

      {/* Filtrage instantané : pas de bouton « chercher » à viser, la touche
          « rechercher » du clavier mobile suffit. */}
      <form
        className="mt-4"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(value);
        }}
      >
        <TextField
          tone="night"
          type="search"
          label="Numéro de billet ou nom"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSubmitted(e.target.value);
          }}
          placeholder="NDG-B8K2X-03 ou Martin"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
        />
      </form>

      <div aria-live="polite" className="mt-4">
        {needle.length > 0 && needle.length < 2 && (
          <p className="text-on-night-muted text-sm">Saisissez au moins 2 caractères.</p>
        )}
        {needle.length >= 2 && results.length === 0 && (
          <p className="text-on-night-soft text-[0.9375rem]">
            Aucun billet ne correspond dans la liste chargée.
          </p>
        )}

        {results.length > 0 && (
          <ul className="space-y-2.5">
            {results.map((entry) => {
              const used = localScans[entry.i] ?? (entry.c ? new Date(entry.c).toISOString() : null);
              return (
                <li
                  key={entry.i}
                  className="bg-night-high flex items-center justify-between gap-3 rounded-control p-3.5"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">{entry.n}</p>
                    <p className="text-on-night-soft text-sm">
                      {entry.t} · <span className="font-mono">{entry.s}</span>
                    </p>
                    {used && (
                      <p className="text-warning-night mt-0.5 flex items-center gap-1.5 text-sm font-semibold">
                        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                        Déjà entré à {formatClock(new Date(used), timezone)}
                      </p>
                    )}
                  </div>
                  <Button tone="night" onClick={() => onValidate(entry)} className="shrink-0">
                    {used ? 'Vérifier' : 'Valider'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
