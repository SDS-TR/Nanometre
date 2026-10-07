# Le Nanomètre

Application mobile du salon de barbier pour hommes, à Québec. Phase 1 : l’espace client, de la vitrine jusqu’au paiement, en français (Québec), montants en dollars canadiens.

Le thème sombre est le défaut. Le thème clair suit le réglage du profil. Toutes les couleurs, les espacements (grille de 4 px) et la typographie (Playfair Display SemiBold, Inter) viennent de `src/theme.ts`, lu par `useTheme`.

## Lancer l’app

Il faut Node.js 22 (https://nodejs.org). Les commandes ci-dessous partent du dossier du projet.

macOS ou Linux :

```bash
npm install
cp .env.example .env
npx expo start
```

Windows (PowerShell) :

```powershell
npm install
Copy-Item .env.example .env
npx expo start
```

Si `npm install` s’arrête sur un conflit de dépendances, relancer avec `npm install --legacy-peer-deps`.

`npx expo start` ouvre Metro. Ensuite :

- **Web** : appuyer sur `w`. Le script `npm run web` ouvre aussi le navigateur sur http://127.0.0.1:43123.
- **Expo Go** : installer Expo Go sur le téléphone, le mettre sur le même Wi-Fi que le PC, puis scanner le QR code du terminal. Sur Windows, autoriser Node dans le pare-feu si le téléphone ne joint pas Metro.

Sans variable d’environnement, ou avec `EXPO_PUBLIC_DATA_SOURCE=local` dans `.env`, les données restent dans l’application : catalogue, rendez-vous de démonstration et comptes ci-dessous. Ne pas y coller de clé secrète Stripe ni de clé `service_role`.

`EXPO_PUBLIC_SENTRY_DSN` vide : aucun envoi Sentry, et `Sentry.init` n’est pas appelé. Ne pas définir ce DSN avant l’EFVP décrite plus bas. `EXPO_PUBLIC_DEMO_DATE=1` n’agit qu’en développement (`__DEV__`) : l’espace équipe s’ouvre alors sur le 3 octobre 2026. Sinon, la date est celle du jour à Québec (`America/Toronto`).

| Compte | Courriel | Mot de passe | Rôle |
| --- | --- | --- | --- |
| Alex Gagnon | alex.gagnon@exemple.ca | nanometre | client |
| Karim B. | karim@lenanometre.ca | nanometre | propriétaire |
| Julien Morel | julien.morel@lenanometre.ca | nanometre | coiffeur |

Ces mots de passe sont publics et ne conviennent qu’à la démonstration locale. Ils ne doivent pas servir sur un projet hébergé.

```bash
npm run typecheck
npm run lint
npm test
```

## Parcours client

Onglets : Accueil, Coiffeurs, Rendez-vous, Profil.

Réserver : prestation, coiffeur (ou « Peu importe »), créneau, récapitulatif, paiement, confirmation. Les créneaux sont au quart d’heure, du mardi au samedi, de 9 h à 19 h. Rien ne se termine après 19 h. Une prestation de 20 min occupe un palier de 30 min ; l’heure affichée reste la durée réelle.

Le récapitulatif d’une coupe + barbe à 55,00 $ affiche TPS 2,75 $, TVQ 5,49 $, total 63,24 $. Chaque taxe est arrondie au cent sur le montant avant taxes.

Paiement : « Payer en ligne » ou « Payer sur place ». Carte, Apple Pay et Google Pay vivent dans la feuille Stripe, pas dans l’écran. Sur un build natif avec `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, l’app ouvre PaymentSheet. Sur le web, une feuille de démonstration reprend le même libellé : la carte `4242…` réussit, `4000…0002` est refusée.

Annulation gratuite jusqu’à 24 h avant le rendez-vous (24 h pile est encore gratuit). Plus tard, et seulement si le rendez-vous en ligne est déjà payé, le salon retient 50 % du prix avant taxes, taxes incluses. Pour 27,50 $ : TPS 1,31 $, TVQ 2,49 $, hors taxes 23,70 $, remboursement 35,74 $. La formule est celle de Revenu Québec (pas une division par 1,14975).

Fidélité : 1 point par dollar avant taxes, arrondi vers le bas, au moment où la visite est honorée. Dix coupes donnent une coupe offerte (prix et taxes à 0). Alex a 7 visites, 280 points et 7 tampons dans le jeu de données.

## Architecture

```
app/                  Expo Router
  (client)/           onglets client
  (admin)/admin/      Tableau, Agenda, Paiements, Gestion (propriétaire) ; Ma journée, Agenda, Clients, Avis (coiffeur)
  reserver/           parcours de réservation, code promo au récapitulatif
src/domain/           créneaux, taxes, frais, fidélité, droits, promos, notifications
src/data/             dépôt local ou Supabase, même interface
src/components/       composants de base, cartes métier, TabBarAdmin
supabase/migrations/  schéma, RLS, fonctions
supabase/functions/   PaymentIntent, webhook Stripe, envoi des notifications
```

La logique métier est dans `src/domain`. Le dépôt local et les fonctions SQL appliquent les mêmes règles. Les tests de `src/domain` verrouillent les exemples du brief.

### Supabase

Le schéma couvre le salon, les coiffeurs, les prestations, l’admissibilité coiffeur–prestation, les horaires, les blocages, les rendez-vous, les paiements, la fidélité, les avis, les profils (client, coiffeur, propriétaire) et le journal d’audit. RLS est activé. Les tables sont fermées à `anon` et `authenticated`, sauf la lecture et la mise à jour de son propre profil. Le catalogue et les rendez-vous passent par des fonctions `security definer` qui masquent les montants pour un coiffeur.

En local :

```bash
supabase start
supabase db reset
```

`db reset` applique les migrations, puis `supabase/seed.catalogue.sql` et `supabase/seed.demo.sql` (comptes, profils et rendez-vous fictifs, local seulement). `scripts/seed-hosted.mjs` refuse toute base qui n’est pas locale et n’applique que le catalogue. `seed.sql` refuse de s’exécuter.

Pour régénérer le SQL et `src/data/seed.normalized.json` :

```bash
npm run seed:sql
```

Ne pas lancer `seed-hosted.mjs` contre le projet hébergé : il s’arrête. Les comptes de démo ne doivent pas y exister. S’ils y sont déjà, les supprimer dans Authentication et révoquer leurs sessions.

Puis, dans l’app :

```
EXPO_PUBLIC_DATA_SOURCE=supabase
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ…
```

Le dernier propriétaire actif ne peut pas être rétrogradé ni désactivé. Un changement de rôle, une désactivation et une annulation écrivent dans `audit_log`.

### Stripe (mode test)

1. Clé publiable dans `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
2. Déployer les fonctions :

```bash
supabase functions deploy create-payment-intent
supabase functions deploy stripe-webhook
supabase functions deploy process-refund
supabase functions deploy abandon-checkout
supabase functions deploy delete-account
supabase functions deploy dispatch-notifications
supabase functions deploy expire-checkouts
supabase secrets set STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_… CRON_SECRET=… EXPO_ACCESS_TOKEN=…
```

`create-payment-intent` vérifie la session, lit le total du rendez-vous et crée un PaymentIntent en CAD. Le client appelle ensuite :

```ts
initPaymentSheet({
  merchantDisplayName: 'Le Nanomètre',
  paymentIntentClientSecret,
  applePay: { merchantCountryCode: 'CA' },
  googlePay: { merchantCountryCode: 'CA', currencyCode: 'CAD', testEnv: __DEV__ },
  defaultBillingDetails: { address: { country: 'CA' } },
  returnURL: 'lenanometre://stripe-redirect',
});
```

Seul le webhook `stripe-webhook` confirme un paiement en ligne, après `constructEventAsync`, et seulement si l’identifiant du PaymentIntent, le montant reçu et la devise CAD correspondent. L’app interroge le rendez-vous ; elle n’appelle plus `confirm_online_payment`. L’URL à coller dans le tableau Stripe est `https://<projet>.supabase.co/functions/v1/stripe-webhook`. Événements : `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `refund.updated`, `charge.dispute.created`. Un remboursement part de `process-refund` (`stripe.refunds.create`) et se termine quand le webhook passe le paiement à `rembourse`.

Identifiant marchand Apple prévu : `merchant.ca.lenanometre` (à remplacer par le vrai Merchant ID).

### Builds EAS

Profils dans `eas.json` : `development` et `preview` restent en source locale. `production` force `EXPO_PUBLIC_DATA_SOURCE=supabase` et refuse de démarrer si l’URL ou la clé anon manque. Schéma d’URL `lenanometre`, iOS `ca.lenanometre.app`, Android `ca.lenanometre.app` avec sauvegarde automatique désactivée. Architecture nouvelle et Hermes, fournis par Expo SDK 57.

```bash
eas build --profile development --platform ios
```

L’intégration continue (`.github/workflows/ci.yml`) lance `expo-doctor`, le contrôle de types, le lint et les tests sur Node 22, y compris Postgres.

## Données et identité

Adresse de démonstration : 425, rue Saint-Vallier Ouest, Québec (Québec) G1K 1K8. Téléphone 418 555-0199. Fuseau `America/Toronto`. Numéros de TPS `123456789 RT0001` et de TVQ `1234567890 TQ0001` : ce sont des espaces réservés.

Les photos dans `assets/photos` restent provisoires. L’accueil ne le dit plus : les remplacer par les photos du salon avant la soumission.

Le jeu `admin_data.json` décrit la journée du 3 octobre 2026, le 6 octobre (Julien), l’historique d’Alex et des clients fréquents, et les annulations tardives du 29 septembre. Le fichier source annonce 4 943 rendez-vous au total ; le seed ne reprend que les lignes concrètes, pour que les montants restent ceux du fichier.

## Espace équipe

`/admin` exige une session. Un client tombe sur « Accès refusé ». Le propriétaire a Tableau, Agenda, Paiements et Gestion. Le coiffeur a Ma journée, son agenda, ses clients (sans montant) et ses avis publiés, en lecture seule. `TabBarAdmin` reçoit le rôle. Les mêmes refus sont appliqués dans le dépôt local et dans les fonctions SQL (`Accès refusé`, SQLSTATE 42501). Le dernier propriétaire actif ne peut pas être rétrogradé ni désactivé. Les changements de rôle, les désactivations et les remboursements de frais sont écrits dans le journal.

Dans Gestion, une invitation hébergée appelle la fonction Edge `invite-team-member`. Elle vérifie que l’appelant est propriétaire, exige une vérification en deux étapes pour inviter un autre propriétaire, puis, avec la clé `service_role`, envoie `auth.admin.inviteUserByEmail`. Le profil est inactif jusqu’à la première connexion. Un coiffeur doit avoir une chaise, et une seule compte actif par chaise. La réponse est `{ invited: true }` : aucun mot de passe n’est renvoyé ni affiché. Le lien dure au plus 24 h, selon le réglage Auth. En mode local, le compte est créé dans l’application et se connecte avec le mot de passe de démonstration déjà documenté.

Le tableau calcule les revenus hors taxes et TTC, l’occupation et les coupes à partir des rendez-vous chargés. Tableau, agenda et paiements s’ouvrent sur aujourd’hui (fuseau `America/Toronto`). La date du 3 octobre 2026 n’apparaît que si `EXPO_PUBLIC_DEMO_DATE=1` et que l’app tourne en développement. Ce ne sont pas les agrégats publiés du grand livre (4 943 rendez-vous). Un client qui ouvre `/admin` voit « Accès refusé » sans la barre d’onglets.

Honorer une visite confirmée dont l’heure est passée ajoute les points et le tampon. Une coupe offerte déjà consommée à la réservation n’en ajoute pas.

Au récapitulatif, un code promo est validé avant les taxes. `BIENVENUE10` est encore valable en octobre 2026. `ETE20` est épuisé.

L’annulation tardive payée sur place est un réglage du salon : aucun frais (défaut) ou montant dû à la prochaine visite. Le paiement en ligne garde les frais de 50 %.

## Notifications

Le profil active ou coupe les avis. Sans opt-in, rien n’est planifié. Avec opt-in : confirmation au client et au coiffeur, rappels 24 h et 2 h avant (omis s’ils sont déjà passés), et un avis au client et au coiffeur si le rendez-vous est annulé ou déplacé. Le lien interne est `/rendez-vous?booking=…` (schéma `lenanometre://`).

Dans Expo Go (SDK 53 et suivants), les notifications distantes ne sont plus fournies. L’app ne charge pas `expo-notifications` dans ce cas : l’opt-in et la liste dans le profil restent disponibles, sans jeton et sans erreur. Un development build ou un build EAS demande la permission et enregistre le jeton Expo. `Constants.executionEnvironment` vaut `storeClient` aussi pour `expo-dev-client`, donc le critère utilisé est la présence d’Expo Go, pas cet environnement. Le web affiche la liste dans le profil. L’envoi serveur est `dispatch-notifications`, appelée par `pg_cron` / `pg_net` avec `CRON_SECRET` (pas la clé service_role). La même clé déclenche `expire-checkouts` toutes les 5 minutes. La déconnexion et le refus des avis effacent le jeton.

```bash
curl -X POST "$SUPABASE_URL/functions/v1/dispatch-notifications" \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Étapes manuelles (Supabase, Stripe, boutiques)

Le dépôt ne déploie pas le projet hébergé. Avant la première mise en production :

- Sauvegarde PITR ou `pg_dump` avant d’appliquer les migrations.
- Contrôles avant migration : `select id, role, barber_id from profiles where role = 'coiffeur' and barber_id is null;` et `select barber_id, count(*) from profiles where active and barber_id is not null group by 1 having count(*) > 1;` doivent être vides.
- Supprimer les comptes de démo dans Auth (cela révoque les sessions), puis vérifier `select count(*) from profiles where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');` vaut 0. Ne jamais lancer `seed.sql` ni `seed.demo.sql` sur le projet hébergé : le premier refuse, le second réinsère Karim comme propriétaire. Le catalogue seul est `seed.catalogue.sql`.
- Appliquer les migrations dans l’ordre, y compris `20261001160000_refund_status`, `20261001160100_security_hardening`, `20261001170000_security_followup`, `20261001180000_security_staging`, puis les trois migrations de la revue du 6 octobre : `20261006170000_review_critical` (`admin_move` et `admin_agenda`), `20261006180000_review_high` (prix, promos, admissibilité) et `20261006190000_review_medium` (notes publiées, heures du salon, `create_booking` avec promo dans la même transaction). Ensuite `20261007160000_non_regression` : casts d’enum dans `create_booking`, planning et coiffeur actif, total à 0 $ confirmé tout de suite, heures bornées sans nom de client, plancher `salon_settings.min_app_version`, jeton push réattribué, `search_path` vide sur les fonctions de la revue. Ne pas réécrire les migrations déjà appliquées en mise en scène.
- Après migration, anon ne doit pouvoir exécuter que `salon_public`, `visible_barbers`, `visible_services`, `visible_reviews`, `list_slots` et `request_account_deletion`. Une table créée ensuite n’est pas accordée à anon : les privilèges par défaut des tables sont retirés.
- Les numéros de TPS et de TVQ du catalogue sont des espaces réservés (`tax_numbers_placeholder`). Les reçus le disent. Quand le comptable fournit les vrais numéros : `update salon_settings set gst_number = '…', qst_number = '…', tax_numbers_placeholder = false where id = 1;`.
- `request_account_deletion` accepte 3 demandes par courriel et par jour, et 20 par heure pour tout le monde. Chaque demande acceptée écrit l’audit et prévient le propriétaire actif. Répondre dans les 30 jours.
- Un paiement abandonné écrit un travail `stripe_intent_jobs` dans la même transaction que l’annulation. `expire-checkouts` le reprend au prochain passage si Stripe a échoué. La file `refund_jobs` pose un bail de 5 minutes : un second passage immédiat ne reprend pas le même travail. Un travail en `echec` après 8 tentatives est signalé au propriétaire.
- Ne jamais mettre l’URL du projet hébergé dans `DATABASE_URL` pour lancer les tests : la suite Postgres efface `public` et `auth`. Elle refuse tout hôte autre que localhost, 127.0.0.1 ou ::1, ainsi qu’un paramètre `host` ou `hostaddr` (même si l’hôte affiché est local), sauf `ALLOW_DISPOSABLE_TEST_DB=1` sur une base jetable. Préférer `TEST_DATABASE_URL`.
- Auth : confirmation de courriel, mot de passe d’au moins 12 caractères, HIBP si le plan le permet, limites de débit, CAPTCHA sur inscription, connexion et OTP, expiration OTP d’au plus une heure, invitations de 24 h. Site URL `https://lenanometre.ca`. Liste de redirection : uniquement `https://lenanometre.ca/auth/callback` (retirer localhost, `lenanometre://` et les jokers). Le fichier `config.toml` garde localhost pour `supabase start` local. Activer le TOTP (Auth, Multi-Factor). Changement de courriel sécurisé.
- Modèle d’invitation : `https://lenanometre.ca/auth/callback?token_hash={{ .TokenHash }}&type=invite`. Le lien magique reste `{{ .ConfirmationURL }}`.
- Déployer les fonctions. `verify_jwt = false` pour `stripe-webhook`, `dispatch-notifications`, `expire-checkouts`, `process-refunds`, `purge-notes`. `verify_jwt = true` pour `create-payment-intent`, `process-refund`, `delete-account`, `abandon-checkout`, `invite-team-member`. Les crons envoient `Authorization: Bearer $CRON_SECRET`.
- Secrets : `STRIPE_SECRET_KEY` de préférence une clé restreinte `rk_live_` (PaymentIntents et remboursements), `STRIPE_WEBHOOK_SECRET` de l’endpoint live, `CRON_SECRET` d’au moins 32 caractères distinct de la clé service, `EXPO_ACCESS_TOKEN`, `INVITE_REDIRECT_URL=https://lenanometre.ca/auth/callback`. Ne pas activer la suppression de compte tant que la clé Stripe est absente.
- Événements Stripe : `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `refund.updated`, `charge.dispute.created`. Version d’API de l’endpoint : `2025-08-27.basil`. Une relivraison pendant le bail de cinq minutes reçoit 503, pour que Stripe réessaie ; un événement déjà traité reçoit 200. Endpoints et secrets de test et de live séparés. Merchant ID Apple `merchant.ca.lenanometre`. Google Pay de production, sans `EXPO_PUBLIC_GOOGLE_PAY_TEST`.
- Cron : déposer `CRON_SECRET` dans Vault, le lire dans le job, ne pas le coller en clair dans `cron.job`. `dispatch-notifications` chaque minute, `expire-checkouts` toutes les 5 minutes, `process-refunds` chaque minute, `purge-notes` chaque nuit. Rapprochement : `select booking_id, refunded_cents, stripe_refund_cents from payments where status = 'remboursement_en_cours' and refunded_cents > stripe_refund_cents;`
- Le propriétaire enrôle le TOTP sur `/mfa`. Les sessions suivantes redemandent le code avant l’espace propriétaire. Le serveur exige aal2 pour le tableau de bord, les clients, les déplacements, les chaises, les blocages et la modération, en plus de l’argent, de l’équipe et des réglages. Un coiffeur garde son horaire, son agenda et la lecture des avis sans cette étape. Activer la sécurité renforcée des push Expo. Publier `https://lenanometre.ca/.well-known/apple-app-site-association` (JSON, sans extension, `application/json`, sans redirection) et `assetlinks.json` avec le certificat de signature Play. La région du projet Supabase (`ca-central-1` de préférence) ne se change pas après création. Vérifier aussi les régions des journaux Stripe et Expo (Loi 25). Le projet de mise en scène est distinct de la production, en mode test Stripe. Valider le chiffrement de session sur un iPhone et un Android réels (Expo Go ou build EAS) : il n’utilise plus WebCrypto. L’essai B-2 est à refaire sur ces appareils avec `react-native-get-random-values` 1.11.0 (version épinglée par Expo, ne pas la remonter) : connexion, fermeture forcée du processus, réouverture, session toujours là.
- Plancher de version : `salon_public()` renvoie `minAppVersion`, lu dans `salon_settings.min_app_version` (défaut `1.0.0`). L’application compare la version du binaire à cette valeur serveur. `extra.minimumVersion` n’existe plus : un binaire ne peut pas se juger trop vieux à partir de sa propre config. Pour forcer un plancher : `update salon_settings set min_app_version = '1.1.0' where id = 1;` puis publier un binaire au moins aussi récent. Tant que l’OTA est éteinte, un binaire trop ancien affiche l’écran qui demande l’App Store ou le Play Store.
- EAS production : `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_live_…`). Optionnel : `EXPO_PUBLIC_SENTRY_DSN`. Ne pas définir `EXPO_PUBLIC_DEMO_DATE` en production.
- Sentry (compte à créer par le salon, pas dans ce dépôt ; ne pas inventer d’organisation). **Loi 25 : ne pas activer `EXPO_PUBLIC_SENTRY_DSN` avant une EFVP, une entente écrite avec Sentry (DPA) et une mise à jour de la politique de confidentialité.** Sentry SaaS n’existe qu’en région États-Unis (Iowa) ou Union européenne (Francfort). Certaines métadonnées restent aux États-Unis même en région UE. Activer le DSN communique donc des renseignements personnels hors du Québec (art. 17). La politique doit nommer ce tiers, la finalité (diagnostic), le transfert hors Québec (art. 8 et 8.2) et l’identifiant d’installation du suivi de session. Tenir le registre des sous-traitants. Recommandation : région **UE**, réglage « Prevent Storing of IP Addresses », Data Scrubber, et champs sensibles additionnels `client_name`, `full_name`, `note`, `token`, `access_token`, `refresh_token`, `authorization`. Le `beforeSend` JavaScript retire courriels, téléphones, UUID, jetons et en-têtes Authorization, tronque les URL à leur chemin, ignore les miettes `console`, et remplace un message serveur sans pile par le code `erreur-serveur`. Il ne s’applique pas aux plantages natifs iOS et Android : le nettoyage de ces plantages repose sur les réglages du projet Sentry ci-dessus. Sans DSN, rien n’est envoyé. Secrets EAS éventuels, seulement après l’EFVP : `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` pour les dSYM et le mapping.
- Mises à jour OTA : `updates.enabled` est `false`. Il n’y a pas d’`updates.url` ni de projet EAS dans le dépôt, donc aucune OTA n’est possible. `runtimeVersion.policy` est `appVersion`. Avant toute activation, **signer les mises à jour** (certificat de signature de code Expo, guide SC-13) : une OTA non signée ne doit pas servir de canal de mise à jour forcée. Ensuite seulement : `npx eas init`, `npx eas update:configure`, coller `https://u.expo.dev/<uuid>` dans `updates.url`, passer `updates.enabled` à `true`, et publier avec `npx eas update --branch production`. Le plancher, lui, est la colonne serveur `min_app_version`, pas une valeur embarquée dans le binaire.
- Manifeste de confidentialité iOS : `ios.privacyManifests` déclare l’absence de suivi, les types collectés (courriel, nom, téléphone, identifiant utilisateur, historique d’achats, données de plantage, identifiant d’appareil pour le jeton push), UserDefaults (`CA92.1`) et l’horodatage de fichiers (`C617.1`). `ITSAppUsesNonExemptEncryption` est `false`. iOS n’a pas de clé `NSUserNotificationsUsageDescription` : elle a été retirée. La permission des notifications est demandée à l’exécution ; `UIBackgroundModes` contient `remote-notification` via `expo-notifications`. Reprendre les mêmes catégories dans les étiquettes App Store Connect.
- Hors ligne : un bandeau s’affiche quand le réseau tombe. Un rafraîchissement qui échoue garde les données déjà à l’écran.
- L’URL Play de suppression est `/suppression` : elle enregistre une demande et ouvre un courriel, sans réinstaller l’app. Les reçus restent six ans, anonymisés. Les notes partent après 24 mois. La politique de confidentialité nomme Supabase, Stripe et Expo, les durées, et le responsable Loi 25.
- Si un vrai `.env` a déjà quitté le poste, régénérer la clé service Supabase, la clé Stripe et le secret du webhook.

## Avant la soumission en boutique

- Photos réelles du salon (les fichiers dans `assets/photos` sont provisoires), adresse et numéros de TPS/TVQ réels, et confirmation comptable des frais taxes incluses.
- Compte EAS, signature des mises à jour, puis seulement `updates.url` et `updates.enabled: true`. Compte Sentry et `EXPO_PUBLIC_SENTRY_DSN` seulement après l’EFVP, l’entente et la politique de confidentialité. Refaire l’essai de session après fermeture forcée sur iPhone et Android.
- Vérifier sur un appareil la taille de texte à 200 %, VoiceOver et TalkBack : le plafond du texte est 200 % (la barre d’onglets reste plus basse pour tenir dans la barre).
- Identifiant marchand Apple, clés Stripe live, URL du webhook.
- Identifiants Expo pour les notifications push, et le cron ci-dessus en production.
- Politique de confidentialité, fiches App Store et Play Store, `eas submit`.
- Clés d’accès (passkeys). Le profil dit encore « bientôt ». Le RP ID prévu est `lenanometre.ca` (`src/lib/passkey.ts`, phases A à C). On n’enrôle pas de passkey tant que Supabase les laisse en bêta. Le propriétaire utilise le TOTP (écran Vérification) avant les actions d’argent, d’équipe et de réglages.
- Page web de suppression : `/suppression`. Dans l’app, Profil → Supprimer mon compte.

## Écarts connus

- Expo SDK 57, et non 54. Rien dans le projet n’est spécifique au SDK 54.
- Le web ne charge pas `@stripe/stripe-react-native`. La feuille de paiement simulée n’existe qu’en mode local. En mode Supabase, sans PaymentSheet, l’app propose de payer sur place.
- La session Supabase native est chiffrée (clé dans le trousseau, contenu dans AsyncStorage). Le web garde le stockage du navigateur. Les liens de connexion passent par PKCE et `https://lenanometre.ca/auth/callback`.
- Le mode local est le défaut, pour que l’app tourne sans compte Supabase. Un rendez-vous d’Alex payé en ligne est ajouté dans les 24 prochaines heures afin de pouvoir montrer l’annulation tardive.
- Les pauses ne sont pas retirées de la capacité, comme le brief le demande.
- Le fichier `.ics` se télécharge sur le web seulement.
