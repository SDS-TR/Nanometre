# Le Nanomètre

Application mobile du salon de barbier pour hommes, à Québec. Phase 1 : l’espace client, de la vitrine jusqu’au paiement, en français (Québec), montants en dollars canadiens.

Le thème sombre est le défaut. Le thème clair suit le réglage du profil. Toutes les couleurs, les espacements (grille de 4 px) et la typographie (Playfair Display SemiBold, Inter) viennent de `src/theme.ts`, lu par `useTheme`.

## Lancer l’app

```bash
npm install
cp .env.example .env
npm run web
```

Le serveur web écoute sur [http://127.0.0.1:43123](http://127.0.0.1:43123). Sans variable d’environnement, les données sont locales : le catalogue, les rendez-vous de démonstration et les trois comptes vivent dans l’application.

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

`db reset` applique la migration puis `supabase/seed.sql` (généré depuis `data/admin_data.json`).

Pour régénérer le SQL et `src/data/seed.normalized.json` :

```bash
npm run seed:sql
```

Sur un projet hébergé, avec une chaîne Postgres :

```bash
SUPABASE_DB_URL=postgresql://… node scripts/seed-hosted.mjs
```

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
supabase secrets set STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_…
```

`create-payment-intent` vérifie la session, lit le total du rendez-vous et crée un PaymentIntent en CAD. Le client appelle ensuite :

```ts
initPaymentSheet({
  merchantDisplayName: 'Le Nanomètre',
  paymentIntentClientSecret,
  applePay: { merchantCountryCode: 'CA' },
  googlePay: { merchantCountryCode: 'CA', currencyCode: 'CAD', testEnv: true },
  defaultBillingDetails: { address: { country: 'CA' } },
  returnURL: 'lenanometre://stripe-redirect',
});
```

Le webhook `stripe-webhook` confirme le rendez-vous si PaymentSheet réussit sans que l’app rappelle le serveur. L’URL à coller dans le tableau Stripe est `https://<projet>.supabase.co/functions/v1/stripe-webhook`.

Identifiant marchand Apple prévu : `merchant.ca.lenanometre` (à remplacer par le vrai Merchant ID).

### Builds EAS

Profils dans `eas.json` : `development` (client de dev), `preview` (distribution interne), `production` (`autoIncrement`). Schéma d’URL `lenanometre`, iOS `ca.lenanometre.app`, Android `ca.lenanometre.app`. Architecture nouvelle et Hermes, fournis par Expo SDK 57.

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

Le tableau calcule les revenus hors taxes et TTC, l’occupation et les coupes à partir des rendez-vous chargés. La vue de démonstration s’ouvre sur le samedi 3 octobre 2026. Ce ne sont pas les agrégats publiés du grand livre (4 943 rendez-vous).

Honorer une visite confirmée dont l’heure est passée ajoute les points et le tampon. Une coupe offerte déjà consommée à la réservation n’en ajoute pas.

Au récapitulatif, un code promo est validé avant les taxes. `BIENVENUE10` est encore valable en octobre 2026. `ETE20` est épuisé.

L’annulation tardive payée sur place est un réglage du salon : aucun frais (défaut) ou montant dû à la prochaine visite. Le paiement en ligne garde les frais de 50 %.

## Notifications

Le profil active ou coupe les avis. Sans opt-in, rien n’est planifié. Avec opt-in : confirmation au client et au coiffeur, rappels 24 h et 2 h avant (omis s’ils sont déjà passés), et un avis au client et au coiffeur si le rendez-vous est annulé ou déplacé. Le lien interne est `/rendez-vous?booking=…` (schéma `lenanometre://`).

Sur le natif, `expo-notifications` demande la permission et enregistre le jeton Expo. Le web affiche la liste dans le profil. L’envoi serveur est la fonction `dispatch-notifications`, à appeler en cron avec la clé `service_role` :

```bash
curl -X POST "$SUPABASE_URL/functions/v1/dispatch-notifications" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

## Avant la soumission en boutique

- Photos, adresse et numéros de TPS/TVQ réels, et confirmation comptable des frais taxes incluses.
- Identifiant marchand Apple, clés Stripe live, URL du webhook.
- Identifiants Expo pour les notifications push, et le cron ci-dessus en production.
- Politique de confidentialité, fiches App Store et Play Store, `eas submit`.
- Clés d’accès (passkeys). Le profil dit encore « bientôt ».

## Écarts connus

- Expo SDK 57, et non 54. Rien dans le projet n’est spécifique au SDK 54.
- Le web ne charge pas `@stripe/stripe-react-native`. La feuille de paiement y est une simulation étiquetée. Le build natif utilise PaymentSheet dès que la clé publiable est présente.
- Le mode local est le défaut, pour que l’app tourne sans compte Supabase. Un rendez-vous d’Alex payé en ligne est ajouté dans les 24 prochaines heures afin de pouvoir montrer l’annulation tardive.
- Les pauses ne sont pas retirées de la capacité, comme le brief le demande.
- Le fichier `.ics` se télécharge sur le web seulement.
