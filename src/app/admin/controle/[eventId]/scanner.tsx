'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff, Download, RefreshCw, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineAlert } from '@/components/ui/states';
import {
  clearQueue,
  enqueueScan,
  getDeviceLabel,
  hashToken,
  loadConflicts,
  loadLastSync,
  loadLocalScans,
  loadManifest,
  loadQueue,
  recordLocalScan,
  saveConflicts,
  saveLastSync,
  saveManifest,
  type ManifestEntry,
  type StoredConflict,
  type StoredManifest,
} from './manifest-store';
import {
  ConflictsPanel,
  ManualLookup,
  StatusStrip,
  VerdictPanel,
  type SyncState,
  type Verdict,
} from './scanner-ui';
import { formatClock } from '@/lib/dates';

/**
 * Poste d'entrée.
 *
 * Principe directeur : le réseau n'est JAMAIS sur le chemin critique. La liste des
 * billets est téléchargée une fois, avant l'ouverture des portes ; chaque scan est
 * tranché localement en quelques millisecondes, puis remonté au serveur dès que
 * possible.
 *
 * Règle d'honnêteté : une validation acceptée localement n'est « confirmée » que
 * lorsque le serveur a répondu. Tant qu'il n'a pas répondu — hors ligne, envoi en
 * échec, envoi en cours — l'interface le dit, et le billet n'est jamais présenté
 * comme enregistré. Une absence de réponse n'est pas un succès.
 */

interface ServerConflict {
  ticketId: string;
  serial: string;
  firstScanAt: string;
  device: string | null;
}

type SyncOutcome =
  | { status: 'empty' }
  | { status: 'offline' }
  | { status: 'failed'; authExpired: boolean }
  | { status: 'ok'; sentIds: string[] };

export function Scanner({
  eventId,
  eventTitle,
  timezone,
  initialStats,
}: {
  eventId: string;
  eventTitle: string;
  timezone: string;
  initialStats: { total: number; checkedIn: number; remaining: number };
}) {
  const [manifest, setManifest] = useState<StoredManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(true);
  const [queueSize, setQueueSize] = useState(0);
  const [scannedHere, setScannedHere] = useState(0);
  const [localScans, setLocalScans] = useState<Record<string, string>>({});
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [conflicts, setConflicts] = useState<StoredConflict[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'danger' | 'success'; text: string } | null>(null);
  const [deviceLabel, setDeviceLabel] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTokenRef = useRef<{ token: string; at: number }>({ token: '', at: 0 });
  const syncInFlight = useRef<Promise<SyncOutcome> | null>(null);
  const manifestRef = useRef<StoredManifest | null>(null);
  manifestRef.current = manifest;

  /* --- Initialisation ---------------------------------------------------- */

  useEffect(() => {
    setDeviceLabel(getDeviceLabel());
    setManifest(loadManifest(eventId));
    setQueueSize(loadQueue(eventId).length);
    const scans = loadLocalScans(eventId);
    setLocalScans(scans);
    setScannedHere(Object.keys(scans).length);
    setLastSync(loadLastSync(eventId));
    setConflicts(loadConflicts(eventId));
    setOnline(navigator.onLine);

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [eventId]);

  /* --- Liste des billets ------------------------------------------------- */

  const downloadManifest = useCallback(async (): Promise<void> => {
    setLoading(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/checkin/manifest?eventId=${eventId}`, { cache: 'no-store' });
      if (response.status === 401) {
        setNotice({ tone: 'danger', text: 'Votre session a expiré : reconnectez-vous, puis rechargez la liste.' });
        return;
      }
      if (!response.ok) throw new Error('refus du serveur');

      const data = (await response.json()) as StoredManifest;
      saveManifest(data);
      setManifest(data);
      setNotice({
        tone: 'success',
        text: `${data.entries.length} billets chargés sur cet appareil. Le scan fonctionne maintenant sans réseau.`,
      });
    } catch {
      setNotice({
        tone: 'danger',
        text: 'Téléchargement impossible : vérifiez la connexion. La liste déjà chargée, s’il y en a une, reste utilisable.',
      });
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  /* --- Synchronisation --------------------------------------------------- */

  /**
   * Envoie les validations en attente.
   *
   * Un seul envoi à la fois : les appels simultanés partagent la même promesse,
   * pour qu'une validation ne parte jamais deux fois.
   */
  const syncQueue = useCallback((): Promise<SyncOutcome> => {
    if (syncInFlight.current) return syncInFlight.current;

    const run = (async (): Promise<SyncOutcome> => {
      const queue = loadQueue(eventId);
      if (queue.length === 0) return { status: 'empty' };
      if (!navigator.onLine) return { status: 'offline' };

      try {
        const response = await fetch('/api/checkin/sync', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ eventId, scans: queue, deviceLabel: getDeviceLabel() }),
        });

        if (!response.ok) return { status: 'failed', authExpired: response.status === 401 };

        const report = (await response.json()) as { accepted: number; conflicts: ServerConflict[] };

        // Le serveur a répondu : seulement maintenant, les validations quittent la file.
        clearQueue(eventId, queue);
        const nowIso = new Date().toISOString();
        saveLastSync(eventId, nowIso);
        setLastSync(nowIso);
        setQueueSize(loadQueue(eventId).length);

        const sentIds = queue.map((q) => q.ticketId);
        const scans = loadLocalScans(eventId);
        const entries = manifestRef.current?.entries ?? [];

        const found: StoredConflict[] = report.conflicts.map((c) => ({
          ticketId: c.ticketId,
          serial: c.serial,
          holderName: entries.find((e) => e.i === c.ticketId)?.n ?? null,
          firstScanAt: c.firstScanAt,
          firstDevice: c.device,
          localScanAt: scans[c.ticketId] ?? null,
        }));

        if (found.length > 0) {
          const merged = [
            ...loadConflicts(eventId).filter((old) => !found.some((f) => f.ticketId === old.ticketId)),
            ...found,
          ];
          saveConflicts(eventId, merged);
          setConflicts(merged);
        }

        // Le verdict affiché passe de « en attente » à « confirmé » — ou à « conflit ».
        setVerdict((current) => {
          if (current?.kind !== 'accepted' || !sentIds.includes(current.entry.i)) return current;
          const conflict = found.find((f) => f.ticketId === current.entry.i);
          return conflict
            ? { kind: 'conflict', conflict, entry: current.entry }
            : { ...current, sync: 'synced' };
        });

        return { status: 'ok', sentIds };
      } catch {
        return { status: 'failed', authExpired: false };
      }
    })().finally(() => {
      syncInFlight.current = null;
    });

    syncInFlight.current = run;
    return run;
  }, [eventId]);

  /** Applique l'issue d'un envoi à la validation qui vient d'avoir lieu. */
  const settleAfterSync = useCallback(
    (ticketId: string, outcome: SyncOutcome) => {
      if (outcome.status === 'failed') {
        setVerdict((v) =>
          v?.kind === 'accepted' && v.entry.i === ticketId ? { ...v, sync: 'failed' as SyncState } : v,
        );
        if (outcome.authExpired) {
          setNotice({
            tone: 'danger',
            text: 'Votre session a expiré : reconnectez-vous pour envoyer les validations. Elles restent sur cet appareil.',
          });
        }
      }
      if (outcome.status === 'offline') {
        setVerdict((v) =>
          v?.kind === 'accepted' && v.entry.i === ticketId ? { ...v, sync: 'offline' as SyncState } : v,
        );
      }
    },
    [],
  );

  // Au retour du réseau, puis régulièrement : on renvoie ce qui attend.
  useEffect(() => {
    if (!online) return;
    void syncQueue();
    const id = setInterval(() => void syncQueue(), 20_000);
    return () => clearInterval(id);
  }, [online, syncQueue]);

  /* --- Validation d'un billet identifié ---------------------------------- */

  /**
   * Point de passage UNIQUE : la caméra et la saisie manuelle aboutissent ici.
   * Les règles du « premier scan gagne » ne vivent donc qu'à un seul endroit.
   */
  const commitEntry = useCallback(
    (entry: ManifestEntry): void => {
      const scans = loadLocalScans(eventId);
      const here = scans[entry.i];
      const server = entry.c;

      if (here || server) {
        setVerdict({
          kind: 'already',
          entry,
          at: here ?? new Date(server!).toISOString(),
          sameDevice: Boolean(here),
        });
        vibrate([80, 60, 80]);
        return;
      }

      const scannedAt = new Date().toISOString();
      recordLocalScan(eventId, entry.i, scannedAt);
      enqueueScan(eventId, { ticketId: entry.i, scannedAt, deviceLabel: getDeviceLabel() });

      setLocalScans(loadLocalScans(eventId));
      setScannedHere((n) => n + 1);
      setQueueSize(loadQueue(eventId).length);

      const willSync = navigator.onLine;
      setVerdict({ kind: 'accepted', entry, sync: willSync ? 'syncing' : 'offline' });
      vibrate(60);

      if (willSync) {
        void syncQueue().then(async (outcome) => {
          settleAfterSync(entry.i, outcome);
          // Un envoi déjà en cours a pu partir avant cette validation : on repasse.
          if (loadQueue(eventId).some((q) => q.ticketId === entry.i) && navigator.onLine) {
            settleAfterSync(entry.i, await syncQueue());
          }
        });
      }
    },
    [eventId, settleAfterSync, syncQueue],
  );

  /* --- Validation d'un code lu ------------------------------------------- */

  const handleToken = useCallback(
    async (token: string): Promise<void> => {
      const current = manifestRef.current;
      if (!current) return;

      // Un QR reste devant la caméra plusieurs images d'affilée : on ignore les
      // répétitions immédiates pour ne pas faire clignoter le verdict.
      const now = Date.now();
      if (lastTokenRef.current.token === token && now - lastTokenRef.current.at < 2500) return;
      lastTokenRef.current = { token, at: now };

      const digest = await hashToken(token);
      const entry = current.entries.find((e) => e.h === digest);

      if (entry) {
        commitEntry(entry);
        return;
      }

      // Absent de la liste : billet acheté depuis le téléchargement, ou code
      // étranger. En ligne, le serveur tranche ; hors ligne, on ne peut PAS
      // trancher — et on le dit, au lieu de déclarer le billet faux.
      if (!navigator.onLine) {
        setVerdict({ kind: 'invalid', offline: true, reason: 'unknown' });
        vibrate([200]);
        return;
      }

      try {
        const response = await fetch('/api/checkin/scan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, eventId, deviceLabel: getDeviceLabel() }),
        });
        const outcome = await response.json();

        if (outcome.result === 'ok') {
          const confirmed: ManifestEntry = {
            h: digest,
            i: outcome.ticket.id,
            s: outcome.ticket.serial,
            n: outcome.ticket.holderName,
            t: outcome.ticket.ticketTypeName,
            c: null,
          };
          setScannedHere((n) => n + 1);
          setVerdict({ kind: 'accepted', entry: confirmed, sync: 'synced' });
          vibrate(60);
          void downloadManifest();
          return;
        }

        if (outcome.result === 'already') {
          setVerdict({
            kind: 'already',
            entry: {
              h: digest,
              i: outcome.ticket.id,
              s: outcome.ticket.serial,
              n: outcome.ticket.holderName,
              t: outcome.ticket.ticketTypeName,
              c: null,
            },
            at: new Date(outcome.checkedInAt).toISOString(),
            sameDevice: false,
          });
          vibrate([80, 60, 80]);
          return;
        }

        setVerdict({
          kind: 'invalid',
          offline: false,
          reason:
            outcome.result === 'wrong_event' || outcome.result === 'cancelled'
              ? outcome.result
              : 'unknown',
        });
        vibrate([200]);
      } catch {
        // Le réseau a lâché en cours de route : pas de réponse n'est pas « valide ».
        setVerdict({ kind: 'invalid', offline: true, reason: 'unknown' });
        vibrate([200]);
      }
    },
    [commitEntry, downloadManifest, eventId],
  );

  /* --- Caméra ------------------------------------------------------------- */

  const stopCamera = useCallback((): void => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async (): Promise<void> => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Caméra arrière : celle qu'on pointe vers le téléphone du public.
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setCameraOn(true);

      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d', { willReadFrequently: true });

      const tick = (): void => {
        if (!canvas || !context || !video.videoWidth) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });

        if (code?.data) void handleToken(code.data);
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setCameraError(
        'La caméra n’est pas accessible : autorisez-la dans le navigateur, ou utilisez la saisie manuelle plus bas.',
      );
    }
  }, [handleToken]);

  useEffect(() => stopCamera, [stopCamera]);

  /* --- Rendu -------------------------------------------------------------- */

  const checkedIn = initialStats.checkedIn + scannedHere;
  const remaining = Math.max(initialStats.total - checkedIn, 0);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <StatusStrip
        online={online}
        queueSize={queueSize}
        lastSyncIso={lastSync}
        manifestCount={manifest ? manifest.entries.length : null}
        manifestAtIso={manifest?.generatedAt ?? null}
        timezone={timezone}
      />

      {notice && (
        <InlineAlert tone={notice.tone} surface="night">
          {notice.text}
        </InlineAlert>
      )}

      {!manifest ? (
        <section className="bg-night-raised border-warning-night rounded-panel border-[3px] border-dashed p-6">
          <h2 className="text-warning-night text-xl font-semibold">Chargez la liste avant d&apos;ouvrir les portes</h2>
          <p className="text-on-night-soft mt-2">
            Une fois téléchargée, elle reste sur cet appareil et le contrôle fonctionne même sans réseau.
            À faire pendant que vous avez encore du signal.
          </p>
          <Button size="lg" block tone="night" className="mt-5" loading={loading} onClick={downloadManifest} disabled={!online}>
            <Download className="size-5" aria-hidden />
            Charger les billets de « {eventTitle} »
          </Button>
          {!online && (
            <p className="text-on-night-soft mt-3 text-sm">
              Hors ligne : la liste ne peut pas être téléchargée pour le moment.
            </p>
          )}
        </section>
      ) : (
        <>
          <section aria-label="Compteurs d'entrées">
            <dl className="grid grid-cols-3 gap-3 text-center">
              <Counter label="Entrées" value={checkedIn} strong />
              <Counter label="Attendus" value={initialStats.total} />
              <Counter label="Restants" value={remaining} />
            </dl>
          </section>

          {/* Zone caméra : taille fixe, qu'elle soit active ou non — rien ne bouge au démarrage. */}
          <section aria-label="Scanner un billet">
            <div className="bg-night-raised border-night-rule relative aspect-square max-h-[56svh] w-full overflow-hidden rounded-panel border">
              <video
                ref={videoRef}
                playsInline
                muted
                className={cameraOn ? 'absolute inset-0 size-full object-cover' : 'hidden'}
                aria-label="Flux de la caméra"
              />

              {cameraOn ? (
                <>
                  {/* Cadre de visée : aide à centrer le QR sans réfléchir. */}
                  <div className="pointer-events-none absolute inset-[16%]" aria-hidden>
                    <span className="absolute top-0 left-0 size-8 rounded-tl-lg border-t-4 border-l-4 border-white" />
                    <span className="absolute top-0 right-0 size-8 rounded-tr-lg border-t-4 border-r-4 border-white" />
                    <span className="absolute bottom-0 left-0 size-8 rounded-bl-lg border-b-4 border-l-4 border-white" />
                    <span className="absolute right-0 bottom-0 size-8 rounded-br-lg border-r-4 border-b-4 border-white" />
                  </div>
                  <Button
                    size="sm"
                    tone="night"
                    variant="solid"
                    className="absolute right-3 bottom-3"
                    onClick={stopCamera}
                  >
                    <CameraOff className="size-4" aria-hidden />
                    Arrêter
                  </Button>
                </>
              ) : (
                <div className="absolute inset-0 grid place-items-center p-6">
                  <div className="text-center">
                    <Camera className="text-on-night-muted mx-auto size-12" aria-hidden strokeWidth={1.5} />
                    <Button size="lg" tone="night" className="mt-5" onClick={startCamera}>
                      Démarrer le scan
                    </Button>
                    <p className="text-on-night-muted mt-3 text-sm">
                      Ou utilisez la saisie manuelle plus bas.
                    </p>
                  </div>
                </div>
              )}
            </div>
            <canvas ref={canvasRef} className="hidden" />
            {cameraError && (
              <InlineAlert tone="danger" surface="night" className="mt-3">
                {cameraError}
              </InlineAlert>
            )}
          </section>

          <VerdictPanel verdict={verdict} timezone={timezone} onNext={() => setVerdict(null)} />

          <ConflictsPanel
            conflicts={conflicts}
            timezone={timezone}
            onDismiss={(ticketId) => {
              const next = conflicts.filter((c) => c.ticketId !== ticketId);
              saveConflicts(eventId, next);
              setConflicts(next);
            }}
          />

          <ManualLookup
            entries={manifest.entries}
            localScans={localScans}
            timezone={timezone}
            onValidate={commitEntry}
          />

          <section aria-label="Outils de synchronisation" className="flex flex-wrap gap-3">
            <Button
              tone="night"
              variant="secondary"
              disabled={queueSize === 0 || !online}
              onClick={async () => {
                const outcome = await syncQueue();
                if (outcome.status === 'failed') {
                  setNotice({
                    tone: 'danger',
                    text: outcome.authExpired
                      ? 'Votre session a expiré : reconnectez-vous. Les validations restent sur cet appareil.'
                      : 'Envoi impossible pour le moment. Les validations restent sur cet appareil et seront renvoyées.',
                  });
                } else if (outcome.status === 'ok') {
                  setNotice({ tone: 'success', text: `${outcome.sentIds.length} validation(s) enregistrée(s) sur le serveur.` });
                }
              }}
            >
              <UploadCloud className="size-4" aria-hidden />
              Synchroniser maintenant{queueSize > 0 ? ` (${queueSize})` : ''}
            </Button>
            <Button tone="night" variant="secondary" disabled={loading || !online} loading={loading} onClick={downloadManifest}>
              <RefreshCw className="size-4" aria-hidden />
              Recharger la liste
            </Button>
          </section>

          <p className="text-on-night-muted text-center text-xs">
            Cet appareil : <span className="font-mono">{deviceLabel || '…'}</span>
            {manifest && ` · liste du ${formatClock(new Date(manifest.generatedAt), timezone)}`}
          </p>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Counter({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div
      className={
        strong
          ? 'bg-on-night text-night rounded-panel px-2 py-3.5'
          : 'bg-night-raised border-night-rule rounded-panel border px-2 py-3.5'
      }
    >
      <dd className="display text-display-lg leading-none tabular-nums">{value}</dd>
      <dt className={strong ? 'mt-1.5 text-xs font-semibold' : 'text-on-night-soft mt-1.5 text-xs font-semibold'}>
        {label}
      </dt>
    </div>
  );
}

/** Vibration courte : le retour visuel seul ne suffit pas dans le bruit. */
function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* non supporté */
  }
}
