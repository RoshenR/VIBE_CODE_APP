import { cn } from '@/lib/cn';

/**
 * Signature graphique : des lignes fines qui ondulent comme le reflet des
 * lumières sur la Garonne — ou comme l'enveloppe d'un signal audio. L'amplitude
 * est maximale au centre de la zone et s'éteint sur les bords : on lit un pic
 * d'énergie, pas un motif répété.
 *
 * Rendu une fois côté serveur, sans JavaScript client ; le tracé est
 * déterministe (même graine → mêmes lignes), donc stable d'un rendu à l'autre.
 *
 * Règle d'usage : la signature soutient le contenu et ne le recouvre jamais.
 * Elle est décorative (`aria-hidden`) et prend la couleur du texte courant, ce
 * qui garantit qu'elle reste toujours dans la palette de la surface où elle est
 * posée.
 */

type Envelope = 'center' | 'left' | 'right' | 'flat';

interface Props {
  lines?: number;
  /** Fait varier le dessin sans changer le style. */
  seed?: number;
  /** Amplitude relative à l'espacement des lignes (1 = ondes qui se frôlent). */
  amplitude?: number;
  /** Nombre d'oscillations sur la largeur. */
  cycles?: number;
  envelope?: Envelope;
  strokeWidth?: number;
  className?: string;
}

const W = 1000;
const H = 400;
const STEP = 16;

function envelopeAt(x: number, kind: Envelope): number {
  if (kind === 'flat') return 1;
  const center = kind === 'left' ? 170 : kind === 'right' ? 830 : 500;
  const spread = kind === 'center' ? 230 : 300;
  // Un socle de 12 % : les lignes ne deviennent jamais parfaitement droites.
  return 0.12 + 0.88 * Math.exp(-(((x - center) / spread) ** 2));
}

function buildPaths(lines: number, seed: number, amplitude: number, cycles: number, kind: Envelope) {
  const spacing = H / (lines + 1);
  const amp = spacing * amplitude * 1.7;
  const freq = (cycles * Math.PI * 2) / W;

  return Array.from({ length: lines }, (_, i) => {
    const baseline = (i + 1) * spacing;
    const phase = seed * 0.37 + i * 0.42;
    let d = '';

    for (let x = 0; x <= W; x += STEP) {
      const env = envelopeAt(x, kind);
      // Une seconde harmonique, plus faible, rend la houle moins mécanique.
      const wave =
        Math.sin(freq * x + phase) + 0.32 * Math.sin(freq * 2.3 * x + phase * 1.7);
      const y = baseline + amp * env * wave;
      d += `${d ? 'L' : 'M'}${x} ${y.toFixed(1)}`;
    }

    // Plus lumineuses au centre de la nappe, elles s'effacent vers les bords.
    const position = lines === 1 ? 0 : (2 * i) / (lines - 1) - 1;
    const opacity = 0.2 + 0.8 * (1 - Math.abs(position) ** 1.6);

    return { d, opacity: Number(opacity.toFixed(2)) };
  });
}

export function WaveLines({
  lines = 9,
  seed = 1,
  amplitude = 0.9,
  cycles = 3.2,
  envelope = 'center',
  strokeWidth = 1.4,
  className,
}: Props) {
  const paths = buildPaths(lines, seed, amplitude, cycles, envelope);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn('block size-full', className)}
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={p.opacity}
          // Un trait de même épaisseur quelle que soit la déformation du cadre.
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/** Petit pictogramme de marque : trois vagues, à côté du nom. */
export function WaveGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 20"
      className={cn('h-5 w-8 shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1 4C6 0 10 8 16 4S26 0 31 4" />
      <path d="M1 10C6 6 10 14 16 10S26 6 31 10" />
      <path d="M1 16C6 12 10 20 16 16S26 12 31 16" />
    </svg>
  );
}
