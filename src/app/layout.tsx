import type { Metadata, Viewport } from 'next';
import { displayFont, sansFont } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Les Nuits de la Garonne — Concerts et soirées à Bordeaux',
    template: '%s — Les Nuits de la Garonne',
  },
  description:
    'Billetterie des Nuits de la Garonne : concerts et soirées à Bordeaux. Réservez vos places en quelques secondes.',
  applicationName: 'Les Nuits de la Garonne',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#111416',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${displayFont.variable} ${sansFont.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
