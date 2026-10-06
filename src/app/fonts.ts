import localFont from 'next/font/local';

/**
 * Deux familles, pas une de plus.
 *
 *  • Big Shoulders Display — condensée aux formes carrées, un caractère
 *    d'affiche de concert. Réservée aux titres, aux dates et aux chiffres clés.
 *  • Instrument Sans — sans-serif très lisible pour toute l'interface.
 *
 * Les deux sont des polices variables sous licence OFL (textes de licence dans
 * ./fonts). Elles sont embarquées dans le dépôt : aucun appel à un service
 * distant, ce qui préserve la CSP (`font-src 'self'`) et le fonctionnement hors
 * ligne du poste d'entrée.
 *
 * Seul le sous-ensemble latin est chargé : il couvre le français complet (accents,
 * œ, guillemets, €). Un glyphe hors de ce sous-ensemble — un nom d'artiste
 * polonais, par exemple — retombe proprement sur la police de repli.
 */
export const displayFont = localFont({
  src: './fonts/big-shoulders-display-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-display-face',
  display: 'swap',
  adjustFontFallback: 'Arial',
  fallback: ['Arial Narrow', 'Impact', 'sans-serif'],
});

export const sansFont = localFont({
  src: './fonts/instrument-sans-latin-wght-normal.woff2',
  weight: '400 700',
  style: 'normal',
  variable: '--font-sans-face',
  display: 'swap',
  adjustFontFallback: 'Arial',
  fallback: ['system-ui', 'Segoe UI', 'sans-serif'],
});
