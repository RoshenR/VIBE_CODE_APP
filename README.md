# Billetterie — Les Nuits de la Garonne

Outil de billetterie pour collectifs organisateurs de concerts. Conçu pour que
les incidents qui ont motivé ce projet — survente, réservations fantômes, double
billet, contrôle d'accès sur liste papier — soient **structurellement
impossibles**, et non simplement improbables.

---

## Démarrage

Prérequis : Docker Desktop (ou Docker Engine + Compose).

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

| Adresse | Quoi |
| --- | --- |
| http://localhost:3000 | Billetterie publique |
| http://localhost:3000/admin | Espace organisateur |
| http://localhost:8025 | Boîte mail de développement (tous les e-mails sortants) |

> Le conteneur PostgreSQL est publié sur le port **5433**, pas 5432 : une
> installation locale de PostgreSQL occupe souvent 5432 et empêcherait le
> conteneur de s'y lier. Surchargez `POSTGRES_PORT` si vous préférez un autre
> port — pensez alors à ajuster `DATABASE_URL`.

Comptes de démonstration créés par `db:seed` — mot de passe `nuits2026` :

| Adresse | Rôle |
| --- | --- |
| `marie@nuitsdelagaronne.fr` | Responsable, Les Nuits de la Garonne |
| `entree@nuitsdelagaronne.fr` | Poste d'entrée |
| `sam@collectif-echo.fr` | Responsable, Collectif Écho |

Connectez-vous avec deux comptes différents dans deux navigateurs : chacun ne voit
que ses propres événements et ses propres chiffres.

### Sans Docker

Il suffit d'un PostgreSQL 16 joignable et d'un serveur SMTP. Renseignez
`DATABASE_URL` et les variables `SMTP_*` dans `.env`, puis lancez `npm run dev`
et `npm run worker` dans deux terminaux.

---

## Les six garanties

### 1. La survente est impossible

C'est le point qui a déclenché le projet : douze places vendues en trop parce que
trois personnes ont validé le formulaire dans la même minute.

L'erreur classique est de lire le stock puis de l'écrire :

```ts
// ✗ Entre la lecture et l'écriture, n'importe qui peut passer.
if (await placesDisponibles(categorie) >= n) {
  await reserver(categorie, n);
}
```

Ici, la condition et la mutation tiennent dans **une seule instruction SQL**
([`src/server/inventory.ts`](src/server/inventory.ts)) :

```sql
UPDATE ticket_types
   SET quantity_reserved = quantity_reserved + $qty
 WHERE id = $id
   AND quantity_reserved + $qty <= quantity_total
RETURNING quantity_total - quantity_reserved AS remaining;
```

Zéro ligne modifiée signifie « plus assez de places » et annule toute la
transaction. La ligne est verrouillée par l'`UPDATE` lui-même ; en isolation
`READ COMMITTED`, une transaction concurrente bloquée sur ce verrou **réévalue sa
clause `WHERE`** sur la version à jour de la ligne dès sa libération. La garantie
ne dépend donc ni d'un verrou applicatif, ni d'`SERIALIZABLE`, ni du nombre de
personnes qui cliquent en même temps.

Pour une commande portant sur plusieurs catégories, les réservations se font dans
la même transaction et **triées par identifiant** : deux commandes croisées
(fosse puis balcon / balcon puis fosse) ne peuvent pas s'interbloquer.

Vérification : `npm run test:concurrency` lance 50 réservations simultanées sur
10 places, puis 200 sur 25, et vérifie qu'il en passe exactement 10 et 25.

### 2. Une réservation non payée finit par libérer ses places

Le débat interne — « dix minutes » contre « trop court pour un virement » — se
tranche par le moyen de paiement plutôt que par un chiffre unique :

| Paiement | Délai par défaut | Réglage |
| --- | --- | --- |
| Carte bancaire | 15 minutes | `events.hold_minutes_card` |
| Virement | 72 heures | `events.hold_hours_transfer` |

Les deux valeurs se modifient par événement. Un rappel automatique part à
mi-parcours du délai. Le worker balaie les réservations échues toutes les 30
secondes, relâche le stock et prévient aussitôt la liste d'attente.

**Cas limite traité** : un virement qui arrive *après* l'expiration. Le système
tente de reprendre les places ; si elles sont parties, la commande reste expirée
et l'incident est journalisé pour remboursement. Encaisser sans pouvoir livrer
serait pire que de traiter le cas explicitement.

### 3. Une notification de paiement répétée ne crée jamais deux billets

Deux barrières indépendantes :

1. `payment_events.provider_event_id` porte une contrainte **UNIQUE**. Une
   notification déjà reçue échoue à l'insertion, l'endpoint répond `200` et ne
   fait rien — ce qui stoppe aussi les relances du prestataire.
2. La confirmation est un `UPDATE … WHERE status = 'pending'`. Même avec deux
   identifiants différents pour un même paiement, aucun second billet n'est émis.

L'enregistrement de la notification et la confirmation sont dans **la même
transaction**.

Vérification : `npm run test:webhook`, ou le bouton « Renvoyer la même
notification » sur la page de paiement simulée.

### 4. La liste d'attente respecte l'ordre d'arrivée

File FIFO stricte. Quand une place se libère, la première personne compatible
reçoit un lien nominatif à usage unique valable 6 h (réglable). Différence
essentielle avec la gestion manuelle sur Instagram : **les places sont réellement
détenues en base pendant toute la durée de l'offre**. L'offre n'est jamais une
promesse en l'air.

Quelqu'un qui demande 4 places alors qu'il n'en reste que 2 n'est pas doublé : on
attend qu'assez de places se libèrent. Sauter son tour trahirait la seule
promesse faite aux gens.

### 5. Un billet ne passe qu'une fois, même sans réseau

Le QR contient `v1.<uuid>.<HMAC-SHA256>`. La signature empêche de **fabriquer**
un billet ; elle n'empêche pas d'en photographier un — c'est le scan qui s'en
charge :

```sql
UPDATE tickets SET checked_in_at = $now
 WHERE id = $id AND checked_in_at IS NULL
```

Premier scan validé, tous les suivants affichent l'heure du premier passage.

**Hors ligne** : avant l'ouverture des portes, l'appareil télécharge un manifeste
et le conserve localement. Le manifeste ne contient que des **empreintes
SHA-256** des jetons — un téléphone perdu ne permet pas de fabriquer des billets.
Le scan est tranché localement en quelques millisecondes ; les validations sont
mises en file et synchronisées au retour du réseau. Une saisie manuelle du numéro
de billet reste disponible (caméra refusée, écran cassé, obscurité).

> **Limite assumée.** Hors ligne, la détection de doublon est fiable *par
> appareil*. Si le même billet est scanné sur deux postes tous deux déconnectés,
> le conflit est **signalé explicitement** à la synchronisation plutôt
> qu'ignoré. Un seul poste de scan par porte élimine le cas.

### 6. Les collectifs ne voient pas les chiffres des autres

`organization_id` porte l'isolation. Toutes les lectures de l'admin passent par
[`src/lib/org.ts`](src/lib/org.ts) ou [`src/lib/api-auth.ts`](src/lib/api-auth.ts),
qui dérivent l'organisation **de la session serveur, jamais d'un paramètre
d'URL**. Un événement d'un autre collectif renvoie `404` et non `403` : confirmer
l'existence d'un identifiant est déjà une fuite.

---

## Sécurité

Les défenses sont listées ici avec ce qu'elles arrêtent concrètement. Celles
marquées ✅ sont couvertes par un test automatisé.

### Authentification

| Défense | Ce qu'elle arrête |
| --- | --- |
| Limitation de débit sur la connexion ✅ | Force brute rapide. 8 tentatives / 5 min par IP **et** par adresse. |
| Verrouillage progressif ✅ | Attaque lente sous le seuil de débit. 5 échecs tolérés, puis délai qui double, plafonné à 15 min. |
| Double authentification (TOTP) ✅ | Mot de passe fuité par ailleurs, hameçonnage. Codes de secours inclus. |
| Jetons de session hachés | Une sauvegarde égarée ne livre aucune session utilisable. |
| Double échéance | Poste laissé ouvert en coulisses : 12 h d'inactivité, 7 jours au maximum. |
| `sessionsValidFrom` | Déconnexion de tous les appareils en une écriture. |
| Cookie `__Host-` en production | Un sous-domaine compromis ne peut pas poser le cookie de session. |
| Réponse à temps constant ✅ | Impossible de découvrir quelles adresses ont un compte. |

Le plafond du verrouillage est délibéré : un blocage définitif serait une arme
retournée contre le propriétaire du compte — il suffirait d'entrer de faux mots
de passe pour le bloquer le soir d'un concert.

### Requêtes

| Défense | Ce qu'elle arrête |
| --- | --- |
| Contrôle d'origine sur les 8 routes POST ✅ | CSRF. Sans lui, un site tiers ayant vu passer un lien de gestion peut faire annuler la commande. |
| Taille de corps plafonnée ✅ | Saturation mémoire par un JSON de 200 Mo. |
| Limitation de débit par usage ✅ | Blocage d'une salle entière par mille réservations fantômes. |
| Plafond de places par adresse | Revente automatisée : une jauge de 80 places qui part en trois minutes. |
| Champs leurres | Le bruit de fond des robots de remplissage. |

Le webhook de paiement fait exception au contrôle d'origine : il vient d'un
serveur tiers. Ce qui l'authentifie, c'est la signature HMAC de son corps.

### En-têtes et navigateur ✅

Politique de contenu stricte avec **nonce par requête** et `strict-dynamic` —
aucun `unsafe-inline` ni `unsafe-eval` sur les scripts en production. S'y
ajoutent `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`,
HSTS, `X-Content-Type-Options`, `Cross-Origin-Opener-Policy`.

`Referrer-Policy: no-referrer` mérite une explication : les liens de gestion de
commande portent leur jeton dans l'URL. Sans cet en-tête, cliquer sur un lien
sortant depuis cette page transmettrait le jeton au site visité — c'est-à-dire
l'accès aux billets.

### Droits et traçabilité

Trois rôles, vérifiés à chaque action ✅ :

| Rôle | Peut |
| --- | --- |
| `owner` | Tout : tarifs, jauges, mise en vente, remboursements, comptes. |
| `staff` | Suivre les ventes, annuler, exporter, scanner. Pas les réglages. |
| `scanner` | **Scanner uniquement.** Ni chiffres, ni export, ni tarifs. |

Le rôle `scanner` existe pour une raison précise : le téléphone du poste
d'entrée passe de main en main toute la soirée et reste parfois déverrouillé sur
une table.

Le **journal d'audit** est en ajout seul — aucune fonction de l'application ne le
modifie ni ne l'efface. Il enregistre connexions, annulations, remboursements,
changements de jauge, exports et téléchargements de la liste des participants,
avec l'auteur, l'heure et une adresse IP tronquée. Consultable par événement.

### Données personnelles

- Adresses IP **tronquées** avant toute journalisation (IPv4 : trois octets ;
  IPv6 : préfixe /48) ✅.
- Le journal d'audit filtre les clés sensibles (`*password*`, `*token*`,
  `*secret*`) avant écriture.
- Le manifeste du poste d'entrée ne contient que des **empreintes** de jetons.
- Chaque export de la liste des participants est journalisé, avec son volume.
- Les e-mails de liste d'attente portent un lien de désinscription et les
  en-têtes `List-Unsubscribe`.

### Secrets et exploitation

Au démarrage, l'application **refuse de se lancer en production** si l'un des
trois secrets est absent, resté sur sa valeur d'exemple, trop court, ou identique
à un autre ✅. Un service qui ne démarre pas est un incident visible en dix
secondes ; une billetterie qui tourne avec un secret public est un incident
découvert le soir du concert.

Conteneurs : utilisateur sans privilèges, `no-new-privileges`, capacités
supprimées, système de fichiers en lecture seule pour l'application, ressources
bornées, base et boîte mail publiées uniquement sur la boucle locale,
`npm ci --ignore-scripts` à la construction.

### Ce qui n'est pas couvert

Honnêteté sur les limites :

- **Pas de protection anti-déni de service distribué.** Les limites sont
  applicatives ; une attaque volumétrique demande un pare-feu en amont
  (Cloudflare, fail2ban).
- **Pas de chiffrement au repos** de la base. Cela relève de l'hébergement.
- **Pas de rotation automatique des secrets.**
- **Le scan hors ligne** détecte les doublons par appareil (voir plus haut).
- **Pas d'audit externe.** Ce document décrit des intentions vérifiées par des
  tests, pas un certificat.

---

## Le reste du brief

- **Annulation autonome** — lien signé reçu par e-mail, aucun compte à créer,
  possible jusqu'à N heures avant le début (réglable par événement). Les places
  repartent en vente et alimentent la liste d'attente.
- **Billets par e-mail** — un QR par place, en pièce jointe intégrée, lisible
  sans réseau devant la salle.
- **Export participants** — CSV séparé par `;` avec BOM UTF-8, ce qu'attend Excel
  en configuration française. Les cellules commençant par `=`, `+` ou `@` sont
  neutralisées.
- **Fuseaux horaires** — stockage UTC, affichage dans le fuseau du lieu, et
  mention de l'heure locale du visiteur quand elle diffère réellement (public à
  l'étranger des événements en ligne).
- **Mobile d'abord** — cibles tactiles de 44 px, police à 16 px pour éviter le
  zoom automatique de Safari, total collant en bas d'écran, rendu serveur pour
  rester rapide en réseau dégradé.

---

## Architecture

```
src/
  db/          schéma Drizzle, migrations, jeu de démonstration
  lib/         signature QR, fuseaux, montants, authentification, validation
  server/
    inventory.ts   ← la garantie anti-survente
    orders.ts      réservation, confirmation, expiration, annulation
    payments/      adaptateur prestataire + simulateur
    waitlist.ts    file FIFO et offres
    checkin.ts     validation des billets et manifeste hors ligne
    reporting.ts   chiffres temps réel et export CSV
  emails/      gabarits des e-mails
  app/         pages publiques, espace organisateur, routes d'API
worker/        expiration, offres, file d'envoi des e-mails
tests/         unitaires, épreuve de concurrence, épreuve d'idempotence
```

Le **worker** n'est pas un confort d'exploitation : sans lui, rien n'expire et la
liste d'attente n'avance pas. Il fait partie de `docker-compose.yml`.

### Brancher un vrai prestataire de paiement

Tout passe par l'interface
[`src/server/payments/provider.ts`](src/server/payments/provider.ts)
(`createCheckout`, `verifyWebhook`, `parseEvent`). Écrivez un fichier voisin de
`simulator.ts`, déclarez-le dans `index.ts`, et changez `PAYMENT_PROVIDER`. Aucun
code métier ne bouge.

Le webhook du prestataire doit pointer sur `/api/webhooks/<nom-du-prestataire>`,
et son identifiant d'événement doit être **stable entre deux envois du même
événement** — c'est ce qui porte l'idempotence.

---

## Tests

```bash
npm test                  # unitaires : tarifs early, signature QR, fuseaux
npm run test:concurrency  # anti-survente sous charge (nécessite PostgreSQL)
npm run test:webhook      # idempotence du paiement (nécessite PostgreSQL)
npm run test:checkin      # contrôle à l'entrée, hors ligne compris
npm run test:rate-limit   # limitation de débit et verrouillage de compte
npm run test:all
```

Les trois dernières épreuves tournent contre un vrai PostgreSQL : c'est justement
son comportement sous concurrence que l'on cherche à éprouver. Une base simulée
prouverait seulement que notre simulation est d'accord avec nous.

Résultats obtenus sur cette base :

| Épreuve | Contrôles |
| --- | --- |
| Unitaires (dont sécurité) | 48 |
| Anti-survente (50/10, 200/25, 60×2/30, catégories croisées) | 18 |
| Idempotence du paiement | 10 |
| Contrôle à l'entrée | 19 |
| Débit et verrouillage | 16 |
| En-têtes de sécurité (bout en bout) | 15 |
| CSRF, taille de corps, accès API (bout en bout) | 7 |

### Vérifications manuelles utiles

| Scénario | Comment |
| --- | --- |
| Cloisonnement | Se connecter avec les deux collectifs dans deux navigateurs et tenter d'ouvrir l'URL d'un événement de l'autre. |
| Double notification | Page de paiement simulée → « Renvoyer la même notification ». |
| Scan hors ligne | Charger la liste, couper le réseau, scanner, rescanner, rétablir le réseau. |
| Fuseaux horaires | Commander avec un navigateur réglé sur un autre fuseau : l'e-mail indique l'heure locale du destinataire. |
| Expiration | Créer une réservation, ramener `hold_minutes_card` à 2 min, attendre. |

---

## Mise en production

À faire avant d'ouvrir les ventes :

1. **Changer les trois secrets** de `.env` (`TICKET_SIGNING_SECRET`,
   `LINK_SIGNING_SECRET`, `PAYMENT_WEBHOOK_SECRET`). Changer le premier après
   émission invaliderait tous les billets déjà envoyés.
2. Renseigner un vrai SMTP à la place de MailHog.
3. Servir le site **en HTTPS** : la caméra du poste de contrôle et le service
   worker exigent un contexte sécurisé.
4. Mettre en place une **sauvegarde de PostgreSQL**. C'est la seule source de
   vérité : billets, paiements et entrées.
5. Vérifier que le conteneur `worker` tourne — sans lui, les réservations
   impayées ne libèrent jamais leurs places.

### Points connus à traiter avant une montée en charge

- Le worker interroge la base par scrutation. Convient largement à une quinzaine
  d'événements par an ; au-delà, une file de messages serait plus économe.
- Les remboursements sont enregistrés mais pas déclenchés auprès du prestataire :
  c'est un geste manuel, volontairement, tant qu'un vrai prestataire n'est pas
  branché.
- Le manifeste hors ligne est rechargé manuellement. Pour une jauge de 600
  places, c'est quelques dizaines de kilo-octets — un rechargement à l'ouverture
  des portes suffit.
