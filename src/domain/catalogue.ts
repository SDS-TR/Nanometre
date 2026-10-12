import { OPEN_WEEKDAYS } from './slots';

/** Règles partagées pour ajouter ou retirer une chaise ou une prestation. Même texte que la migration. */

export const SERVICE_DURATIONS = [15, 20, 30, 40, 45, 60, 75, 90, 120] as const;

export const WEEKDAY_CHIPS = [
  { weekday: 2, label: 'Mar', long: 'mardi' },
  { weekday: 3, label: 'Mer', long: 'mercredi' },
  { weekday: 4, label: 'Jeu', long: 'jeudi' },
  { weekday: 5, label: 'Ven', long: 'vendredi' },
  { weekday: 6, label: 'Sam', long: 'samedi' },
] as const;

export type NewBarberInput = {
  fullName: string;
  shortName: string;
  specialty?: string;
  weekdays: number[];
  serviceIds: string[];
};

export type NewServiceInput = {
  name: string;
  description?: string;
  durationMinutes: number;
  priceCents: number;
  barberIds: string[];
};

export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'element';
}

export function uniqueSlug(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(name);
  let slug = base;
  for (let n = 2; used.has(slug); n += 1) {
    slug = `${base}-${n}`;
  }
  return slug;
}

/** Prénom proposé à partir du nom complet. */
export function suggestShortName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}

export function validateNewBarber(input: NewBarberInput, activeServiceIds: ReadonlySet<string>) {
  const fullName = input.fullName.trim();
  const shortName = input.shortName.trim();
  const specialty = (input.specialty ?? '').trim();
  if (fullName.length < 2 || fullName.length > 80) {
    throw new Error('Indique le nom complet (2 à 80 caractères).');
  }
  if (shortName.length < 1 || shortName.length > 30) {
    throw new Error('Indique le prénom affiché (30 caractères au plus).');
  }
  if (specialty.length > 80) {
    throw new Error('La spécialité est trop longue (80 caractères au plus).');
  }
  const weekdays = [...new Set(input.weekdays)].sort((a, b) => a - b);
  if (weekdays.length === 0 || weekdays.some((day) => !OPEN_WEEKDAYS.some((open) => open === day))) {
    throw new Error('Choisis au moins un jour d’ouverture (mardi au samedi).');
  }
  const serviceIds = [...new Set(input.serviceIds)];
  if (serviceIds.length === 0 || serviceIds.some((id) => !activeServiceIds.has(id))) {
    throw new Error('Choisis au moins une prestation offerte.');
  }
  return { fullName, shortName, specialty: specialty || 'Coiffeur', weekdays, serviceIds };
}

export function validateNewService(input: NewServiceInput, activeBarberIds: ReadonlySet<string>, activeNames: Iterable<string>) {
  const name = input.name.trim();
  const description = (input.description ?? '').trim();
  if (name.length < 2 || name.length > 60) {
    throw new Error('Indique le nom de la prestation (2 à 60 caractères).');
  }
  if (description.length > 240) {
    throw new Error('La description est trop longue (240 caractères au plus).');
  }
  const lower = name.toLocaleLowerCase('fr-CA');
  for (const existing of activeNames) {
    if (existing.toLocaleLowerCase('fr-CA') === lower) {
      throw new Error('Une prestation porte déjà ce nom.');
    }
  }
  const duration = input.durationMinutes;
  if (!Number.isInteger(duration) || duration < 10 || duration > 240 || duration % 5 !== 0) {
    throw new Error('Durée invalide (10 à 240 minutes, par pas de 5).');
  }
  if (!Number.isInteger(input.priceCents) || input.priceCents <= 0 || input.priceCents > 100000) {
    throw new Error('Tarif invalide.');
  }
  const barberIds = [...new Set(input.barberIds)];
  if (barberIds.length === 0 || barberIds.some((id) => !activeBarberIds.has(id))) {
    throw new Error('Choisis au moins un coiffeur actif pour cette prestation.');
  }
  return { name, description, durationMinutes: duration, priceCents: input.priceCents, barberIds };
}

export function upcomingBarberMessage(name: string, count: number): string {
  return `${name} a encore ${count} rendez-vous à venir. Déplace-les ou annule-les dans l’agenda, puis réessaie.`;
}

export function upcomingServiceMessage(name: string, count: number): string {
  return `« ${name} » a encore ${count} rendez-vous à venir. Déplace-les ou annule-les dans l’agenda, puis réessaie.`;
}

export function orphanServiceMessage(shortNames: string[]): string {
  return `C’est la seule prestation de : ${shortNames.join(', ')}. Ajoute-leur une autre prestation avant de retirer celle-ci.`;
}

/** Un rendez-vous compte comme « à venir » tant qu’il n’est pas terminé. */
export function isUpcomingBooking(input: { status: string; endsAt: Date }, now: Date): boolean {
  return (input.status === 'confirme' || input.status === 'en_attente_paiement') && input.endsAt.getTime() > now.getTime();
}

const WEEKDAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;

/** F-3 : mêmes textes que admin_set_weekday. */
export const INVALID_WEEKDAY_MESSAGE = 'Choisis un jour d’ouverture du salon (mardi au samedi).';

export function lastWeekdayMessage(shortName: string): string {
  return `${shortName} doit garder au moins un jour de travail.`;
}

export function upcomingWeekdayMessage(shortName: string, count: number, weekday: number): string {
  return `${shortName} a encore ${count} rendez-vous à venir le ${WEEKDAY_NAMES[weekday] ?? 'jour choisi'}. Déplace-les ou annule-les dans l’agenda, puis réessaie.`;
}

/** F-2 : mêmes textes que admin_reactivate_barber. */
export function reactivateWithoutServiceMessage(shortName: string): string {
  return `${shortName} n’offre plus aucune prestation active. Choisis-lui au moins une prestation, puis réactive-le.`;
}

export function reactivateWithoutWeekdayMessage(shortName: string): string {
  return `${shortName} n’a aucun jour de travail (mardi au samedi). Ajoute-lui un jour, puis réactive-le.`;
}

/** F-1 : même texte que admin_set_active et admin_set_role. */
export const ARCHIVED_CHAIR_MESSAGE = 'La chaise de ce coiffeur est retirée. Réactive-la dans Coiffeurs d’abord.';

/** F-5 : plafond d’invitations par propriétaire, comme claim_invite_attempt. */
export const INVITES_PER_HOUR = 10;
export const INVITE_LIMIT_MESSAGE = 'Trop d’invitations envoyées. Réessaie dans une heure.';

/** N-2 : panne du compteur d’invitations (503), distincte du plafond. */
export const INVITE_UNAVAILABLE_MESSAGE = 'Invitation momentanément impossible. Réessaie dans quelques minutes.';

/** N-1 : même texte que admin_set_service. */
export function upcomingBarberServiceMessage(shortName: string, count: number, serviceName: string): string {
  return `${shortName} a encore ${count} rendez-vous à venir pour « ${serviceName} ». Déplace-les ou annule-les dans l’agenda, puis réessaie.`;
}

/** N-4 : même texte que admin_reactivate_service. */
export function reactivateServiceWithoutBarberMessage(name: string): string {
  return `« ${name} » n’est faite par aucun coiffeur actif. Choisis au moins un coiffeur, puis réactive-la.`;
}
