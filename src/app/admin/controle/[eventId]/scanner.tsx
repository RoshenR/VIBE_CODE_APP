'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  clearQueue,
  enqueueScan,
  getDeviceLabel,
  hashToken,
  loadLocalScans,
  loadManifest,
  loadQueue,
  recordLocalScan,
  saveManifest,
  type ManifestEntry,
  type StoredManifest,
} from './manifest-store';

type Verdict =
  | { kind: 'ok'; entry: ManifestEntry }
  | { kind: 'already'; entry: ManifestEntry; at: string; sameDevice: boolean }
  | { kind: 'invalid' }
  | { kind: 'unknown' };

/**
 * Application de contrôle à l'entrée.
 *
 * Principe : **le réseau n'est jamais sur le chemin critique**. La liste des
 * billets est téléchargée une fois, avant l'ouverture des portes ; chaque scan
 * est tranché localement en quelques millisecondes, puis remonté au serveur dès
 * que possible.
 */
export function Scanner({
  eventId,
  eventTitle,
  initialStats,
}: {
  eventId: string;
  eventTitle: string;
  initialStats: { total: number; checkedIn: number; remaining: number };
}) {
  const [manifest, setManifest] = useState<StoredManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(true);
  const [queueSize, setQueueSize] = useState(0);
  const [scannedHere, setScannedHere] = useState(0);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTokenRef = useRef<{ token: string; at: number }>({ token: '', at: 0 });
  const deviceLabel = useRef<string>('');

  /* --- Initialisation ---------------------------------------------------- */

  useEffect(() => {
    deviceLabel.current = getDeviceLabel();
    setManifest(loadManifest(eventId));
    setQueueSize(loadQueue(eventId).length);
    setScannedHere(Object.keys(loadLocalScans(eventId)).length);
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

  /* --- Téléchargement de la liste ---------------------------------------- */

  const downloadManifest = useCallback(async (): Promise<void> => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/checkin/manifest?eventId=${eventId}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('refus du serveur');

      const data = (await response.json()) as StoredManifest;
      saveManifest(data);
      setManifest(data);
      setMessage(`${data.entries.length} billets chargés sur cet appareil.`);
    } catch {
      setMessage('Téléchargement impossible. Vérifiez la connexion.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  /* --- Synchronisation --------------------------------------------------- */

  const syncQueue = useCallback(async (): Promise<void> => {
    const queue = loadQueue(eventId);
    if (queue.length === 0 || !navigator.onLine) return;

    try {
      const response = await fetch('/api/checkin/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId, scans: queue, deviceLabel: deviceLabel.current }),
      });
      if (!response.ok) return;

      const report = (await response.json()) as {
        accepted: number;
        conflicts: { serial: string }[];
      };

      clearQueue(eventId, queue);
      setQueueSize(loadQueue(eventId).length);

      if (report.conflicts.length > 0) {
        // Signalé, jamais masqué : l'équipe doit savoir qu'un billet a été validé
        // sur deux postes déconnectés.
        setMessage(
          `${report.accepted} scan(s) synchronisé(s). Attention : ${report.conflicts.length} billet(s) déjà validés sur un autre poste (${report.conflicts
            .map((c) => c.serial)
            .join(', ')}).`,
        );
      } else if (report.accepted > 0) {
        setMessage(`${report.accepted} scan(s) synchronisé(s).`);
      }
    } catch {
      // Réseau encore instable : la file reste intacte pour la prochaine tentative.
    }
  }, [eventId]);

  // Synchronisation automatique au retour du réseau, puis régulièrement.
  useEffect(() => {
    if (!online) return;
    void syncQueue();
    const id = setInterval(() => void syncQueue(), 20_000);
    return () => clearInterval(id);
  }, [online, syncQueue]);

  /* --- Validation d'un billet identifié ----------------------------------- */

  /**
   * Enregistre l'entrée pour un billet du manifeste.
   *
   * Point de passage unique : la caméra et la saisie manuelle aboutissent toutes
   * deux ici. Les règles du « premier scan gagne » ne vivent donc qu'à un seul
   * endroit.
   */
  const commitEntry = useCallback(
    (entry: ManifestEntry): void => {
      const localScans = loadLocalScans(eventId);
      const alreadyHere = localScans[entry.i];
      const alreadyServer = entry.c;

      if (alreadyHere || alreadyServer) {
        setVerdict({
          kind: 'already',
          entry,
          at: alreadyHere ?? new Date(alreadyServer!).toISOString(),
          sameDevice: Boolean(alreadyHere),
        });
        return;
      }

      const scannedAt = new Date().toISOString();
      recordLocalScan(eventId, entry.i, scannedAt);
      enqueueScan(eventId, { ticketId: entry.i, scannedAt, deviceLabel: deviceLabel.current });

      setScannedHere((n) => n + 1);
      setQueueSize(loadQueue(eventId).length);
      setVerdict({ kind: 'ok', entry });

      // Vibration courte : le retour visuel seul ne suffit pas dans le bruit.
      try {
        navigator.vibrate?.(60);
      } catch {
        /* non supporté */
      }

      if (navigator.onLine) void syncQueue();
    },
    [eventId, syncQueue],
  );

  /* --- Validation d'un code scanné ---------------------------------------- */

  const handleToken = useCallback(
    async (token: string): Promise<void> => {
      if (!manifest) return;

      // Un QR reste devant la caméra plusieurs images d'affilée : on ignore les
      // répétitions immédiates pour ne pas faire clignoter le verdict.
      const now = Date.now();
      if (lastTokenRef.current.token === token && now - lastTokenRef.current.at < 2500) return;
      lastTokenRef.current = { token, at: now };

      const digest = await hashToken(token);
      const entry = manifest.entries.find((e) => e.h === digest);

      if (!entry) {
        // Soit un QR étranger, soit un billet acheté après le téléchargement de
        // la liste. Si le réseau est là, le serveur tranche.
        if (navigator.onLine) {
          try {
            const response = await fetch('/api/checkin/scan', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ token, eventId, deviceLabel: deviceLabel.current }),
            });
            const outcome = await response.json();

            if (outcome.result === 'ok') {
              setVerdict({
                kind: 'ok',
                entry: {
                  h: digest,
                  i: outcome.ticket.id,
                  s: outcome.ticket.serial,
                  n: outcome.ticket.holderName,
                  t: outcome.ticket.ticketTypeName,
                  c: null,
                },
              });
              setScannedHere((n) => n + 1);
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
                at: outcome.checkedInAt,
                sameDevice: false,
              });
              return;
            }
          } catch {
            // On retombe sur le verdict hors ligne ci-dessous.
          }
        }
        setVerdict({ kind: 'invalid' });
        return;
      }

      commitEntry(entry);
    },
    [manifest, eventId, commitEntry, downloadManifest],
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
        const code = jsQR(image.data, image.width, image.height, {
          inversionAttempts: 'dontInvert',
        });

        if (code?.data) void handleToken(code.data);
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setCameraError(
        "Accès à la caméra refusé. Autorisez-la dans le navigateur, ou saisissez le numéro de billet à la main.",
      );
    }
  }, [handleToken]);

  useEffect(() => stopCamera, [stopCamera]);

  /* --- Rendu -------------------------------------------------------------- */

  const remaining = Math.max(initialStats.total - initialStats.checkedIn - scannedHere, 0);

  return (
    <div className="mt-5">
      {/* Bandeau d'état : lisible d'un coup d'œil, en pleine soirée. */}
      <div className="border-ink-200 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-4 py-3 text-sm">
        <span className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`}
            aria-hidden
          />
          {online ? 'En ligne' : 'Hors ligne — le scan fonctionne'}
        </span>
        <span className="text-ink-500 tabular-nums">
          {manifest ? `${manifest.entries.length} billets en mémoire` : 'liste non chargée'}
          {queueSize > 0 && ` · ${queueSize} à synchroniser`}
        </span>
      </div>

      {!manifest && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-900">
            Chargez la liste avant d&apos;ouvrir les portes
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            Une fois téléchargée, elle reste sur cet appareil et le contrôle
            fonctionne même sans réseau. À faire pendant que vous avez encore du
            signal.
          </p>
          <button
            type="button"
            onClick={downloadManifest}
            disabled={loading}
            className="mt-3 w-full rounded-xl bg-amber-900 px-5 py-3 font-semibold text-white disabled:opacity-60"
          >
            {loading ? 'Téléchargement…' : `Charger les billets de « ${eventTitle} »`}
          </button>
        </div>
      )}

      {manifest && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Counter label="Entrées" value={initialStats.checkedIn + scannedHere} />
            <Counter label="Attendus" value={initialStats.total} />
            <Counter label="Restants" value={remaining} />
          </div>

          <div className="mt-4">
            {!cameraOn ? (
              <button
                type="button"
                onClick={startCamera}
                className="bg-ink-900 hover:bg-ink-800 w-full rounded-xl px-5 py-4 text-lg font-semibold text-white"
              >
                Démarrer le scan
              </button>
            ) : (
              <div className="relative overflow-hidden rounded-2xl bg-black">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="aspect-square w-full object-cover"
                />
                {/* Viseur : aide à cadrer sans réfléchir. */}
                <div
                  className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-white/70"
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={stopCamera}
                  className="absolute right-3 bottom-3 rounded-lg bg-white/90 px-4 py-2 text-sm font-medium"
                >
                  Arrêter
                </button>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {cameraError && (
            <p role="alert" className="mt-3 text-sm text-rose-700">
              {cameraError}
            </p>
          )}

          <VerdictPanel verdict={verdict} onDismiss={() => setVerdict(null)} />

          <ManualEntry manifest={manifest} onValidate={commitEntry} />

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={syncQueue}
              disabled={queueSize === 0 || !online}
              className="border-ink-300 text-ink-700 rounded-xl border px-4 py-2.5 text-sm font-medium disabled:opacity-40"
            >
              Synchroniser ({queueSize})
            </button>
            <button
              type="button"
              onClick={downloadManifest}
              disabled={loading || !online}
              className="border-ink-300 text-ink-700 rounded-xl border px-4 py-2.5 text-sm font-medium disabled:opacity-40"
            >
              Recharger la liste
            </button>
          </div>

          {message && (
            <p className="text-ink-600 mt-3 text-sm" aria-live="polite">
              {message}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-ink-200 rounded-xl border bg-white px-2 py-3">
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-ink-500 text-xs">{label}</p>
    </div>
  );
}

/**
 * Verdict du scan.
 *
 * Couleur franche et texte court : la personne à la porte doit trancher en une
 * seconde, sans lire un paragraphe.
 */
function VerdictPanel({
  verdict,
  onDismiss,
}: {
  verdict: Verdict | null;
  onDismiss: () => void;
}) {
  if (!verdict) return null;

  const styles = {
    ok: 'border-emerald-300 bg-emerald-500 text-white',
    already: 'border-amber-300 bg-amber-500 text-white',
    invalid: 'border-rose-300 bg-rose-600 text-white',
    unknown: 'border-rose-300 bg-rose-600 text-white',
  }[verdict.kind];

  return (
    <div
      role="status"
      aria-live="assertive"
      onClick={onDismiss}
      className={`mt-4 cursor-pointer rounded-2xl border p-5 text-center ${styles}`}
    >
      {verdict.kind === 'ok' && (
        <>
          <p className="text-2xl font-bold">Entrée validée</p>
          <p className="mt-1 text-lg">{verdict.entry.n}</p>
          <p className="text-sm opacity-90">
            {verdict.entry.t} · {verdict.entry.s}
          </p>
        </>
      )}

      {verdict.kind === 'already' && (
        <>
          <p className="text-2xl font-bold">Déjà scanné</p>
          <p className="mt-1 text-lg">{verdict.entry.n}</p>
          <p className="text-sm opacity-90">
            Passage à{' '}
            {new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short' }).format(
              new Date(verdict.at),
            )}
            {verdict.sameDevice ? ' sur ce poste' : ' sur un autre poste'}
          </p>
          <p className="mt-2 text-sm opacity-90">
            Ce billet a déjà servi. Ne pas laisser entrer sans vérification.
          </p>
        </>
      )}

      {(verdict.kind === 'invalid' || verdict.kind === 'unknown') && (
        <>
          <p className="text-2xl font-bold">Billet invalide</p>
          <p className="mt-1 text-sm opacity-90">
            Ce code ne correspond à aucun billet de cette soirée.
          </p>
        </>
      )}

      <p className="mt-3 text-xs opacity-75">Touchez pour continuer</p>
    </div>
  );
}

/**
 * Saisie manuelle du numéro de billet.
 *
 * Indispensable : écran cassé, luminosité impossible, caméra refusée. Sans cette
 * porte de sortie, l'équipe se retrouve bloquée avec une file d'attente devant
 * elle.
 */
function ManualEntry({
  manifest,
  onValidate,
}: {
  manifest: StoredManifest;
  onValidate: (entry: ManifestEntry) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<ManifestEntry | null>(null);

  function search(e: React.FormEvent): void {
    e.preventDefault();
    const needle = value.trim().toUpperCase();
    if (!needle) return;

    const found = manifest.entries.find((entry) => entry.s.toUpperCase() === needle);
    if (!found) {
      setError('Aucun billet avec ce numéro.');
      setMatch(null);
      return;
    }
    setError(null);
    setMatch(found);
  }

  return (
    <details className="border-ink-200 mt-4 rounded-xl border bg-white">
      <summary className="text-ink-700 cursor-pointer px-4 py-3 text-sm font-medium">
        Saisir un numéro de billet à la main
      </summary>
      <div className="px-4 pb-4">
        <form onSubmit={search} className="flex gap-2">
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setMatch(null);
              setError(null);
            }}
            placeholder="NDG-B8K2X-03"
            autoCapitalize="characters"
            className="border-ink-300 min-w-0 flex-1 rounded-lg border px-3 py-2.5 font-mono text-base"
          />
          <button
            type="submit"
            className="bg-ink-900 rounded-lg px-4 py-2.5 text-sm font-semibold text-white"
          >
            Chercher
          </button>
        </form>

        {error && (
          <p role="alert" className="mt-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        {match && (
          <div className="border-ink-200 mt-3 rounded-lg border p-3">
            <p className="font-medium">{match.n}</p>
            <p className="text-ink-500 text-sm">
              {match.t} · {match.s}
            </p>
            <button
              type="button"
              onClick={() => {
                // Même point de passage que la caméra : les règles de validation
                // ne doivent exister qu'à un seul endroit.
                onValidate(match);
                setValue('');
                setMatch(null);
              }}
              className="mt-2 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              Valider l&apos;entrée
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
