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

`db reset` applique les migrations, puis `supabase/seed.demo.sql` (comptes locaux) et `supabase/seed.sql`. Le script `scripts/seed-hosted.mjs` refuse toute base qui n’est pas locale et n’insère jamais ces comptes.

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

L’intégration continue (`.github/workflows/ci.yml`) lance le contrôle de types, le lint et les tests sur Node 22.

## Données et identité

Adresse de démonstration : 425, rue Saint-Vallier Ouest, Québec (Québec) G1K 1K8. Téléphone 418 555-0199. Fuseau `America/Toronto`. Numéros de TPS `123456789 RT0001` et de TVQ `1234567890 TQ0001` : ce sont des espaces réservés.

Les photos dans `assets/photos` sont des images provisoires. L’accueil le dit.

Le jeu `admin_data.json` décrit la journée du 3 octobre 2026, le 6 octobre (Julien), l’historique d’Alex et des clients fréquents, et les annulations tardives du 29 septembre. Le fichier source annonce 4 943 rendez-vous au total ; le seed ne reprend que les lignes concrètes, pour que les montants restent ceux du fichier.

## Espace équipe

`/admin` exige une session. Un client tombe sur « Accès refusé ». Le propriétaire a Tableau, Agenda, Paiements et Gestion. Le coiffeur a Ma journée, son agenda, ses clients (sans montant) et ses avis publiés, en lecture seule. `TabBarAdmin` reçoit le rôle. Les mêmes refus sont appliqués dans le dépôt local et dans les fonctions SQL (`Accès refusé`, SQLSTATE 42501). Le dernier propriétaire actif ne peut pas être rétrogradé ni désactivé. Les changements de rôle, les désactivations et les remboursements de frais sont écrits dans le journal.

Dans Gestion, une invitation hébergée appelle la fonction Edge `invite-team-member`. Elle vérifie que l’appelant est propriétaire, exige une vérification en deux étapes pour inviter un autre propriétaire, puis, avec la clé `service_role`, envoie `auth.admin.inviteUserByEmail`. Le profil est inactif jusqu’à la première connexion. Un coiffeur doit avoir une chaise, et une seule compte actif par chaise. La réponse est `{ invited: true }` : aucun mot de passe n’est renvoyé ni affiché. Le lien dure au plus 24 h, selon le réglage Auth. En mode local, le compte est créé dans l’application et se connecte avec le mot de passe de démonstration déjà documenté.

Le tableau calcule les revenus hors taxes et TTC, l’occupation et les coupes à partir des rendez-vous chargés. La vue de démonstration s’ouvre sur le samedi 3 octobre 2026. Ce ne sont pas les agrégats publiés du grand livre (4 943 rendez-vous).

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

## Avant la soumission en boutique

- Photos, adresse et numéros de TPS/TVQ réels, et confirmation comptable des frais taxes incluses.
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
