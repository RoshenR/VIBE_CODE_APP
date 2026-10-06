# Billetterie « Les Nuits de la Garonne » — Synthèse pour analyse

Document de transmission. Il décrit ce qui existe, ce qui a été vérifié, et — à part égale — ce qui ne l'a pas été. Les affirmations de ce document sont recoupables : chaque garantie renvoie à un fichier et, quand il existe, à un test.

**Statut : prototype fonctionnel et testé, non déployé en production.** Le paiement est simulé.

---

## 1. Contexte et objectif

Un collectif de concerts bordelais (≈ 15 événements par an, 80 à 600 places) vendait ses places par formulaires, virements et fichier Excel partagé. Six incidents ont motivé le projet :

| # | Incident rapporté | Exigence déduite |
|---|---|---|
| 1 | 12 places vendues en trop (3 personnes, même minute) | Aucune survente possible, quelle que soit la concurrence |
| 2 | Réservations jamais payées qui bloquent des places | Expiration automatique, durée adaptée au moyen de paiement |
| 3 | Notification de paiement reçue deux fois → deux billets | Traitement idempotent |
| 4 | Liste d'attente gérée à la main sur Instagram | File automatique, ordre d'arrivée, délai de réponse |
| 5 | Billets présentés deux fois (captures d'écran) | Un billet ne passe qu'une fois |
| 6 | Aucune visibilité temps réel sur ventes et encaissements | Tableau de bord par catégorie de place |

Contraintes additionnelles : deux collectifs partenaires utilisent le même outil **sans voir les chiffres des autres** ; usage sur téléphone avec **mauvaise connexion** à l'entrée ; événements en ligne avec **participants à l'étranger** ; équipe non technique.

## 2. Périmètre livré

**Public :** liste des événements, page événement (catégories, tarif « early » à bascule automatique, compteurs), tunnel de réservation, paiement (simulé), page de gestion de commande par lien signé (billets, annulation autonome), inscription à la liste d'attente, acceptation d'une offre, désinscription.

**Organisateur :** connexion (avec double authentification optionnelle), tableau de bord par événement (encaissé, vendu, en attente, par catégorie, courbe des ventes, entrées en direct), création et réglage des événements et catégories, mise en vente, commandes (annulation/remboursement), liste d'attente, export CSV des participants, liste papier de secours imprimable, journal des actions, page de sécurité du compte.

**Poste d'entrée :** scan caméra, validation locale hors ligne, file de synchronisation, saisie manuelle de secours.

**Interface (refonte visuelle) :** identité « Bordeaux après la tombée du jour » appliquée au public, à l'administration et au poste d'entrée : jetons de couleur sémantiques, polices servies localement, affiches générées à partir des données réelles (aucune photo ni statistique inventée), états jamais portés par la seule couleur, cibles de 44 px, mouvement réduit respecté. Le back-end, les règles de stock, l'authentification et les paiements n'ont pas été modifiés par cette refonte. Détail dans le README, section « Identité visuelle et interface » ; captures dans `docs/captures/`.

**Arrière-plan :** worker (expiration des réservations, rappels, rotation de la liste d'attente, envoi des e-mails avec reprise sur échec, purges).

## 3. Architecture

| Couche | Choix |
|---|---|
| Application | Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4 |
| Base de données | PostgreSQL 16, accès via Drizzle ORM, **une migration** |
| Tâches de fond | Worker Node (`tsx`), scrutation SQL (30 s) — pas de file de messages |
| E-mail | Nodemailer ; Mailpit en développement |
| Authentification | Sessions en base, bcrypt (coût 12), TOTP implémenté sur `node:crypto` |
| Orchestration | Docker Compose : `postgres`, `mailhog` (Mailpit), `web`, `worker` |

**Volumétrie :** 101 fichiers source, ≈ 12 650 lignes, 10 routes API, 18 pages, 16 tables, 7 modules de sécurité.

**Tables :** `organizations`, `users`, `sessions`, `events`, `ticket_types`, `orders`, `order_items`, `tickets`, `checkin_logs`, `payment_intents`, `payment_events`, `waitlist_entries`, `email_outbox`, `rate_limits`, `login_attempts`, `audit_log`.

**Ports (hôte) :** web `3000` ; PostgreSQL `127.0.0.1:5433` (et non 5432, souvent occupé par une installation locale) ; Mailpit `127.0.0.1:1025/8025`.

**Choix d'architecture notables**
- Un monolithe Next.js plutôt qu'une API séparée : un seul déploiement à exploiter pour une équipe non technique.
- Les règles critiques vivent **en base**, pas dans le code applicatif (voir §4).
- Pas de Redis : compteurs de débit, verrouillage et file d'e-mails sont en PostgreSQL.
- Tous les horodatages en UTC (`timestamptz`) ; fuseau du lieu stocké par événement.

## 4. Les six garanties métier

| Garantie | Mécanisme | Fichier |
|---|---|---|
| **Zéro survente** | Une seule instruction `UPDATE … WHERE quantity_reserved + n <= quantity_total`. Condition et écriture sont indissociables ; en `READ COMMITTED`, une transaction bloquée réévalue son `WHERE` sur la version à jour. Réservations multi-catégories triées par identifiant (pas d'interblocage). | `src/server/inventory.ts` |
| **Libération des réservations** | Cycle `pending → paid \| expired \| cancelled`. Carte : 15 min ; virement : 72 h ; réglables par événement. Le worker libère le stock et relance la liste d'attente. Un virement arrivant *après* expiration tente de reprendre les places, sinon signale un remboursement. | `src/server/orders.ts`, `worker/index.ts` |
| **Idempotence du paiement** | Deux barrières : contrainte `UNIQUE` sur l'identifiant d'événement du prestataire, et confirmation conditionnée à `status = 'pending'`. Enregistrement et confirmation dans une même transaction. | `src/server/payments/index.ts` |
| **Liste d'attente** | File FIFO. Pendant une offre, les places sont **réellement détenues**. Une personne qui demande plus que le stock disponible n'est pas doublée. | `src/server/waitlist.ts` |
| **Billet à usage unique** | QR `v1.<uuid>.<HMAC-SHA256>`. Premier scan : `UPDATE … WHERE checked_in_at IS NULL`. Hors ligne : manifeste d'**empreintes SHA-256** (pas de jetons), file de synchronisation, conflit entre deux appareils signalé. | `src/server/checkin.ts`, `src/lib/qr.ts` |
| **Cloisonnement des collectifs** | `organization_id` ; l'organisation est dérivée de la **session serveur**, jamais d'un paramètre de requête ; 404 (et non 403) hors périmètre. | `src/lib/org.ts`, `src/lib/api-auth.ts` |

## 5. Sécurité

### Mise en œuvre

| Domaine | Mesures |
|---|---|
| Authentification | Limitation de débit (8 / 5 min, par IP et par adresse) ; verrouillage progressif (5 échecs libres, délai doublé, plafonné à 15 min) ; TOTP avec codes de secours hachés ; jeton de session **haché** en base ; échéance absolue 7 j + inactivité 12 h ; invalidation globale par `sessionsValidFrom` ; cookie `__Host-` en production ; hachage même si le compte n'existe pas |
| Requêtes | Contrôle d'origine sur 7 des 8 routes POST (le webhook, appelé par un serveur tiers, y échappe par nécessité et est authentifié par la signature HMAC de son corps) ; taille de corps plafonnée ; limitation de débit par usage ; plafond de places par adresse e-mail et par événement ; champs leurres |
| Navigateur | CSP à nonce par requête + `strict-dynamic`, sans `unsafe-inline`/`unsafe-eval` sur les scripts en production ; `frame-ancestors 'none'` ; `Referrer-Policy: no-referrer` (les liens de commande portent leur jeton dans l'URL) ; HSTS ; `X-Content-Type-Options` ; COOP/CORP |
| Droits | Trois rôles vérifiés à chaque action : `owner`, `staff`, `scanner` (**scan uniquement**). Matrice dans un module pur testable |
| Traçabilité | Journal d'audit en ajout seul (connexions, annulations, remboursements, jauges, exports, téléchargements du manifeste) ; IP tronquées ; clés sensibles filtrées |
| Secrets | Démarrage **refusé en production** si un secret est absent, par défaut, trop court, peu varié ou dupliqué (`src/instrumentation.ts`) |
| Conteneurs | Utilisateur non-root, `no-new-privileges`, capacités supprimées, système de fichiers en lecture seule (web), ressources bornées, base et Mailpit sur boucle locale, `npm ci --ignore-scripts` |
| Données personnelles | IP tronquées ; export de la liste des participants journalisé ; lien et en-têtes `List-Unsubscribe` sur les e-mails de liste d'attente |

### Ce qui n'est pas couvert
- Déni de service distribué (il faut un pare-feu en amont) ; chiffrement de la base au repos ; rotation automatique des secrets ; **aucun audit de sécurité externe**.

## 6. Vérification

Toutes les épreuves ci-dessous ont été **relancées en bloc, sans échec, après la dernière modification du code** (`npm run test:all` + `tsc --noEmit`). Les épreuves d'intégration tournent contre un **vrai PostgreSQL** : c'est son comportement sous concurrence qui est éprouvé.

| Épreuve | Contrôles | Ce qu'elle démontre |
|---|---|---|
| Unitaires (dont sécurité et interface) | 117 | Tarifs early, signature QR, fuseaux, secrets, TOTP, jetons signés, matrice des droits ; heure murale → UTC autour du changement d'heure, règles de programmation et d'état de vente, **contrastes WCAG mesurés sur les jetons réels de `globals.css`** |
| Anti-survente | 19 | 50 tentatives/10 places → exactement 10 ; 200/25 → exactement 25 ; groupes de 2 ; pas d'interblocage sur commandes croisées |
| Idempotence du paiement | 10 | La même notification × 5 → un seul jeu de billets ; deux identifiants pour un paiement → toujours un seul jeu |
| Contrôle à l'entrée | 19 | Rescan refusé ; 3 portes simultanées → 1 seul passage ; signature falsifiée ; synchronisation hors ligne ; conflit signalé |
| Débit et verrouillage | 16 | 60 requêtes simultanées → exactement 12 acceptées ; verrou persistant, croissant, plafonné |

**Vérifications manuelles de bout en bout** (non automatisées, scripts hors dépôt) : 15 en-têtes de sécurité ; rejet d'une origine étrangère, d'une requête sans origine, d'un corps de 200 ko ; 401 sur l'API sans session ; QR refusé sans jeton ; webhook non signé refusé ; connexion réelle dans un navigateur ; e-mails reçus avec 2 QR intégrés et heure convertie dans le fuseau du destinataire.

### Défauts découverts par les tests (corrigés)
1. **La limitation de débit était inopérante.** Le pilote PostgreSQL refusait un objet `Date` dans un gabarit SQL brut ; l'erreur tombait dans le `catch` « laisser passer ». Aucun signal. Trouvé par un test sur base réelle.
2. File d'e-mails lue **sans ordre explicite** : un message récent pouvait attendre indéfiniment derrière un arriéré.
3. Épreuve d'idempotence **non rejouable** (identifiant codé en dur) : le produit avait raison, le test avait tort.
4. `next start` incompatible avec `output: 'standalone'` : le middleware de sécurité ne s'exécutait pas lors des vérifications locales.
5. Conteneur `web` exécutant une **image périmée** par rapport au schéma → échec de connexion. Corrigé par reconstruction.

## 7. Points d'attention — à lire avant toute mise en production

Classés par importance. **Rien ici n'est caché dans le code ; tout est reproductible.**

**Élevé**
1. **`TRUST_PROXY=false` rend les limites de débit globales.** Sans proxy de confiance, l'adresse cliente vaut une valeur constante (`directe`). Conséquence : *tous* les visiteurs partagent un seul compteur. Huit échecs de connexion par n'importe qui bloquent la connexion de tous pendant 5 min ; 12 réservations en 5 min plafonnent la billetterie entière. **En production derrière un reverse proxy, `TRUST_PROXY=true` est obligatoire**, et le proxy doit écraser `X-Forwarded-For`.
2. **Secrets copiés dans l'image Docker.** Il n'existait pas de `.dockerignore` : `COPY . .` embarquait `.env`. Un `.dockerignore` a été ajouté, mais **les images déjà construites contiennent encore `.env`** tant qu'elles ne sont pas reconstruites. Ne diffuser aucune de ces images ; reconstruire (`docker compose build --no-cache`) et **régénérer les secrets** si une image a pu circuler.
3. **Paiement simulé uniquement.** Aucun prestataire réel n'est branché ; le remboursement est enregistré mais **non exécuté** auprès d'un prestataire. L'interface est prévue (`src/server/payments/provider.ts`).

**Moyen**
4. **Rang de la liste d'attente non protégé en concurrence.** `joinWaitlist` calcule `MAX(position)+1` dans une transaction sans verrou ni contrainte d'unicité sur `(event_id, position)` ; un commentaire du code affirme à tort un « verrou d'insertion ». Deux inscriptions simultanées peuvent obtenir le même rang. **Non testé.**
5. **Conteneur `web` « unhealthy ».** Le serveur écoute sur le nom d'hôte du conteneur ; le contrôle de santé interroge `127.0.0.1` (refusé, vérifié). L'application fonctionne, mais l'orchestrateur la croirait en panne. Correctif : `HOSTNAME=0.0.0.0`. Non appliqué.
6. **`ALLOW_PAYMENT_SIMULATOR` non transmis au conteneur `web`** par `docker-compose.yml` : en mode production, le simulateur y répond « Indisponible ».
7. **La limitation de débit « laisse passer » si la base est injoignable** (choix assumé : la disponibilité prime). À réviser si ce n'est pas l'arbitrage souhaité.
8. **Double authentification facultative et non imposée**, y compris aux responsables. Un bandeau l'incite ; rien ne l'exige.
9. **Comptes de démonstration** (mot de passe dans `src/db/seed.ts`) : publics par nature, à ne jamais créer en production.

**Faible / limites assumées**
10. Hors ligne, la détection de double passage est fiable **par appareil** ; un conflit entre deux appareils déconnectés n'est détecté qu'à la synchronisation (signalé explicitement).
11. Le seuil « 2 mois » et autres délais sont des valeurs par défaut réglables, non des règles métier validées par le client.
12. Pas de gestion de comptes utilisateurs dans l'interface (création/suppression) ; le rôle `compte.gerer` est défini mais sans écran associé.

## 8. Couverture de tests : ce qui n'est PAS testé automatiquement

- Le flux complet de la **liste d'attente** (offre, expiration, acceptation, désinscription) — vérifié à la lecture, pas par test.
- La **reprise d'une commande expirée** payée tardivement (`reclaimExpiredOrder`).
- L'**interface** : seuls les helpers purs et les contrastes sont testés. Les pages ont été parcourues à la main dans un navigateur (accueil, événement dans tous ses états, réservation, commande, simulateur, liste d'attente, administration, scanner), avec mesure du débordement horizontal à 360, 390, 768 et 1440 px et des cibles tactiles — mais **pas de test automatisé de rendu** ni de test sur un vrai téléphone. Les **actions serveur** par rôle de bout en bout (seule la matrice des droits est testée), le **parcours TOTP** dans l'interface (seul l'algorithme l'est).
- Les **e-mails** : vérifiés une fois à la main.
- Le **plafond de places par adresse e-mail** et les **règles de disponibilité par date** (début/fin de vente d'une catégorie).
- Le **scan caméra** réel et le **service worker** hors ligne : jamais testés sur un téléphone.
- Les scripts de vérification de bout en bout (en-têtes, CSRF) ne sont **pas dans le dépôt**.
- Aucune mesure de **performance sous charge réelle** ; les épreuves de concurrence portent sur des centaines de requêtes, pas des milliers.

## 9. Exploitation

```bash
cp .env.example .env            # puis REMPLACER les 3 secrets (voir ci-dessous)
docker compose up -d --build    # postgres, mailpit, web, worker
npm install && npm run db:migrate && npm run db:seed   # seed : démonstration uniquement
npm run test:all                # nécessite PostgreSQL
```

Générer un secret : `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` (×3, valeurs **distinctes**, ≥ 32 caractères).

- **Reconstruire les conteneurs après toute modification du code ou du schéma** (`docker compose up -d --build web worker`), sinon ils exécutent l'ancienne version (incident n°5).
- **Le worker est indispensable** : sans lui, rien n'expire et la liste d'attente n'avance pas.
- Variables de sécurité : `TRUST_PROXY`, `ADDITIONAL_ORIGINS`, `DATABASE_SSL` (`require`/`strict`), `ALLOW_PAYMENT_SIMULATOR`.
- À prévoir avant ouverture : HTTPS (caméra et service worker l'exigent), sauvegarde PostgreSQL, SMTP réel, retrait de la publication du port de la base, `TRUST_PROXY=true`.

## 10. Dépôt

Un seul commit (`init`) ; `.env` est ignoré et non suivi. Le fichier `package-lock.json` est modifié et non commité. Documentation d'usage : `README.md` (inclut le détail des garanties et de la sécurité).

## 11. Pistes non réalisées

Transfert de billet par lien signé · cartes Apple/Google Wallet · codes promotionnels et invitations · remboursement automatique · rapport de clôture d'événement (présence, no-shows) · version anglaise · gestion des comptes utilisateurs · exigence de la double authentification pour les responsables.
