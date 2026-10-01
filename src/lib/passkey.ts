/**
 * Seam passkeys. Ne pas activer tant que Supabase Auth les laisse en bêta.
 * Le RP ID définitif est lenanometre.ca : le changer invaliderait toutes les clés.
 *
 * Phase A : enrôlement proposé aux propriétaires et coiffeurs, passkey ou TOTP (aal2).
 * Phase B : proposition aux clients après la première réservation. Lien magique PKCE en repli.
 * Phase C : connexion passkey d'abord, mot de passe en secours.
 */
export const passkeyRpId = 'lenanometre.ca';

export const passkeysAvailable = false;

export const passkeyPhases = ['A', 'B', 'C'] as const;
