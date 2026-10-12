import { addDaysIso } from './zonedTime';

/**
 * Le seed de démo est écrit pour la semaine du mardi 6 octobre 2026 : les visites
 * passées s’arrêtent le samedi 3 et les rendez-vous à venir commencent le mardi 6.
 * En mode démo, on décale tout le seed d’un nombre entier de semaines pour que ce
 * mardi tombe aujourd’hui ou au prochain mardi. Les jours de la semaine restent
 * les mêmes (les visites du seed tombent du mardi au samedi). Jamais utilisé en production.
 */
export const SEED_ANCHOR_DATE = '2026-10-06';

function dayNumber(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Jours à ajouter aux dates du seed (multiple de 7, jamais négatif). */
export function demoRebaseDays(todayIso: string): number {
  const diff = dayNumber(todayIso) - dayNumber(SEED_ANCHOR_DATE);
  if (diff <= 0) {
    return 0;
  }
  return Math.ceil(diff / 7) * 7;
}

export function rebaseIso(isoDate: string, days: number): string {
  return days === 0 ? isoDate : addDaysIso(isoDate, days);
}
