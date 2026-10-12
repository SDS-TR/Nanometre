/**
 * N-3 : liste blanche des messages que l’app peut montrer tels quels.
 *
 * Ce sont les textes en français de nos fonctions SQL (RAISE et réponses `error`),
 * de l’Edge Function d’invitation et des règles partagées du mode démo. Tout le
 * reste (Postgres, PostgREST, Auth, réseau, délais, interblocages) devient le texte
 * de repli de l’écran. Un `%` dans un modèle remplace une valeur, comme dans RAISE.
 */

export const KNOWN_MESSAGES: readonly string[] = [
  // Accès et session
  'Accès refusé',
  'Vérification renforcée requise',
  'Profil inactif',
  'Connexion requise',
  'Connecte-toi pour continuer.',
  'Session invalide.',
  'Ce compte est désactivé.',
  'Courriel ou mot de passe incorrect.',
  'Aucun compte pour ce courriel.',
  'Un compte existe déjà avec ce courriel.',
  'Ce lien n’est plus valide.',
  'Lien invalide ou expiré.',
  'Le mot de passe doit contenir au moins 8 caractères.',
  'Le mot de passe doit contenir au moins 12 caractères.',
  'Compte créé. Confirme le courriel si le salon l’exige, puis connecte-toi.',
  'Confirme ton courriel avant de réserver.',
  'Indique ton nom.',
  'Courriel invalide.',
  'Téléphone invalide',
  'Adresse invalide',
  'Ce téléphone est déjà lié à un autre compte.',
  'Écris SUPPRIMER pour confirmer.',
  // Équipe et invitations
  'Il doit rester au moins un propriétaire actif.',
  'Il doit rester au moins un propriétaire actif',
  'Il doit rester au moins un coiffeur actif.',
  'Cette chaise a déjà un compte actif.',
  'Choisis la chaise de ce coiffeur.',
  'Coiffeur invalide.',
  'Membre introuvable.',
  'Profil introuvable.',
  'Invitation incomplète.',
  'Invitation impossible.',
  'Ce courriel a déjà un compte.',
  'Ce coiffeur est retiré. Réactive-le avant de l’inviter.',
  'L’invitation se fait par le serveur.',
  'Trop d’invitations envoyées. Réessaie dans une heure.',
  'Invitation momentanément impossible. Réessaie dans quelques minutes.',
  'Le profil n’a pas pu être lié.',
  'Le journal n’a pas pu être écrit.',
  'Supabase n’est pas configuré.',
  'Méthode refusée.',
  'La chaise de ce coiffeur est retirée. Réactive-la dans Coiffeurs d’abord.',
  // Chaises et prestations
  'Coiffeur introuvable.',
  'Ce coiffeur est inactif.',
  'Ce coiffeur est retiré.',
  'Ce coiffeur est déjà actif.',
  'Ce coiffeur est déjà retiré.',
  'Ce coiffeur n’est plus à l’horaire.',
  'Choisis un coiffeur.',
  'Prestation introuvable.',
  'Prestation introuvable',
  'Cette prestation est retirée.',
  'Cette prestation est déjà active.',
  'Cette prestation est déjà retirée.',
  'Une prestation porte déjà ce nom.',
  'Le catalogue doit garder au moins une prestation.',
  'Un coiffeur actif doit garder au moins une prestation.',
  'Ce coiffeur ne fait pas cette prestation.',
  'Indique le nom complet (2 à 80 caractères).',
  'Indique le prénom affiché (30 caractères au plus).',
  'Indique le nom de la prestation (2 à 60 caractères).',
  'La spécialité est trop longue (80 caractères au plus).',
  'La description est trop longue (240 caractères au plus).',
  'Durée invalide (10 à 240 minutes, par pas de 5).',
  'Durée invalide',
  'Tarif invalide.',
  'Montant invalide',
  'Choisis au moins un jour d’ouverture (mardi au samedi).',
  'Choisis au moins un jour de travail.',
  'Choisis un jour de la semaine.',
  'L’heure de fermeture doit suivre l’heure d’ouverture.',
  'Le salon doit ouvrir au moins un jour.',
  'Choisis au moins une prestation offerte.',
  'Choisis au moins un coiffeur actif pour cette prestation.',
  'Choisis un jour d’ouverture du salon (mardi au samedi).',
  'Choisis un autre coiffeur actif.',
  'Mode démo seulement.',
  // Salon, agenda et réservations
  'Réglage invalide.',
  'Heure invalide.',
  'Date invalide.',
  'Dates invalides.',
  'La fin doit suivre le début.',
  'L’heure de fin doit suivre l’heure de début.',
  'Le salon est fermé ce jour-là.',
  'Ce coiffeur ne travaille pas ce jour-là.',
  'Créneau invalide.',
  'Ce créneau est déjà passé.',
  'Ce créneau n’est pas libre.',
  'Ce créneau n’est plus libre.',
  'Ce créneau a déjà un rendez-vous.',
  'Ce créneau est hors des heures d’ouverture.',
  'Choix incomplet.',
  'Rendez-vous introuvable.',
  'Blocage introuvable.',
  'Ce rendez-vous est déjà annulé.',
  'Ce rendez-vous ne peut plus être annulé.',
  'Ce rendez-vous ne peut pas être déplacé.',
  'Ce rendez-vous est déjà payé en ligne.',
  'Tu as déjà trois rendez-vous à venir.',
  'Trop de réservations. Réessaie dans une heure.',
  'Cette visite ne peut pas être honorée.',
  'La visite n’a pas encore commencé.',
  'État invalide',
  // Paiements, codes promo, fidélité et avis
  'Ce paiement ne peut pas être confirmé.',
  'Paiement incohérent',
  'Paiement en cours de validation.',
  'Annule d’abord le paiement en cours.',
  'Annule le paiement en cours avant d’appliquer un code.',
  'Aucun frais à rembourser.',
  'Stripe n’a pas renvoyé de PaymentIntent.',
  'Réponse vide du serveur.',
  'Code invalide.',
  'Ce code n’est pas reconnu.',
  'Ce code n’est pas valable à cette date.',
  'Ce code a atteint sa limite.',
  'Ce code ne change pas le montant.',
  'Ce code ne peut pas être appliqué.',
  'Tu as déjà utilisé ce code.',
  'Trop de tentatives. Réessaie plus tard.',
  'Le pourcentage doit être entre 1 et 100.',
  'Le montant doit être supérieur à 0.',
  'Limite invalide.',
  'Aucune coupe offerte à utiliser.',
  'Aucune coupe offerte à utiliser',
  'Choisis une note entre 1 et 5.',
  'Tu pourras laisser un avis une fois la coupe honorée.',
  'Avis introuvable.',
];

/** Messages avec des valeurs. Même écriture que les RAISE de la base. */
export const KNOWN_TEMPLATES: readonly string[] = [
  '% a encore % rendez-vous à venir. Déplace-les ou annule-les dans l’agenda, puis réessaie.',
  '« % » a encore % rendez-vous à venir. Déplace-les ou annule-les dans l’agenda, puis réessaie.',
  '% a encore % rendez-vous à venir le %. Déplace-les ou annule-les dans l’agenda, puis réessaie.',
  '% a encore % rendez-vous à venir pour « % ». Déplace-les ou annule-les dans l’agenda, puis réessaie.',
  'C’est la seule prestation de : %. Ajoute-leur une autre prestation avant de retirer celle-ci.',
  '% doit garder au moins un jour de travail.',
  '% n’offre plus aucune prestation active. Choisis-lui au moins une prestation, puis réactive-le.',
  '% n’a aucun jour de travail (mardi au samedi). Ajoute-lui un jour, puis réactive-le.',
  '% n’a aucun jour de travail. Ajoute-lui un jour, puis réactive-le.',
  '« % » n’est faite par aucun coiffeur actif. Choisis au moins un coiffeur, puis réactive-la.',
  'Ces rendez-vous sortent des nouvelles heures : %.',
  'Ces rendez-vous à venir sortent des nouvelles heures (%). Identifiants : %.',
];

const MAX_LENGTH = 400;
const exact = new Set(KNOWN_MESSAGES);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
}

const patterns = KNOWN_TEMPLATES.map((template) => new RegExp(`^${template.split('%').map(escapeRegExp).join('[^\\n]{1,200}?')}$`));

export function isKnownServerMessage(text: string): boolean {
  if (!text || text.length > MAX_LENGTH) {
    return false;
  }
  return exact.has(text) || patterns.some((pattern) => pattern.test(text));
}

function messageOf(reason: unknown): string {
  if (typeof reason === 'string') {
    return reason;
  }
  if (reason && typeof reason === 'object' && 'message' in reason && typeof (reason as { message: unknown }).message === 'string') {
    return (reason as { message: string }).message;
  }
  return '';
}

/**
 * Message à afficher à l’écran. Seuls les messages connus passent ; tout le reste
 * (message brut de Postgres, de PostgREST, d’Auth ou du réseau) devient `fallback`.
 */
export function friendlyError(reason: unknown, fallback: string): string {
  const text = messageOf(reason).trim();
  return isKnownServerMessage(text) ? text : fallback;
}
