import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /*
   * Sortie « standalone » uniquement pour l'image Docker.
   *
   * Ce mode produit un serveur autonome minimal, idéal en conteneur — mais il
   * rend `next start` inopérant, donc impossible de lancer un build de
   * production en local pour le vérifier. La construire à la demande garde les
   * deux usages fonctionnels ; le Dockerfile pose la variable.
   */
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,

  // Ne pas annoncer la technologie employée : cela ne sert qu'à celui qui
  // cherche des vulnérabilités connues pour cette version.
  poweredByHeader: false,

  // Les en-têtes de sécurité sont posés par src/proxy.ts, qui génère un
  // nonce par requête — impossible depuis une configuration statique.
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
