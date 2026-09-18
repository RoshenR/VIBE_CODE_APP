# syntax=docker/dockerfile:1

# Version épinglée par empreinte plutôt que par étiquette : une étiquette peut
# être redéployée sur une autre image, l'empreinte non. C'est ce qui rend une
# construction reproductible et vérifiable.
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

FROM base AS deps
COPY package.json package-lock.json* ./
# `npm ci` respecte le fichier de verrouillage à la lettre ; `--ignore-scripts`
# empêche une dépendance d'exécuter du code arbitraire pendant l'installation,
# qui est le vecteur privilégié des attaques sur la chaîne d'approvisionnement.
RUN npm ci --ignore-scripts || npm install --ignore-scripts

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=true
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

# Utilisateur sans privilèges. L'image node fournit déjà `node` (uid 1000) :
# une évasion de processus n'obtient alors pas les droits root sur l'hôte.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

# Le worker exécute le TypeScript directement via tsx.
FROM base AS worker
ENV NODE_ENV=production
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node
CMD ["npx", "tsx", "worker/index.ts"]
