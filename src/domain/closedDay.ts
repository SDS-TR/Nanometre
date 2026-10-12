import { isOpenWeekday } from './slots';
import type { SalonDay } from './salonWeek';
import { addDaysIso, weekdayOfIso } from './zonedTime';

const NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;

/** « Salon fermé le lundi. » seulement si le propriétaire a fermé ce jour-là dans Horaires. */
export function closedDayMessage(isoDate: string, week: readonly SalonDay[] | null | undefined): string | null {
  if (!week) {
    return null;
  }
  const weekday = weekdayOfIso(isoDate);
  return isOpenWeekday(weekday, week) ? null : `Salon fermé le ${NAMES[weekday]}.`;
}

/** Premier jour ouvert après `isoDate` (exclu). */
export function nextOpenDate(isoDate: string, week: readonly SalonDay[] | null | undefined): string {
  let cursor = addDaysIso(isoDate, 1);
  for (let guard = 0; guard < 7 && !isOpenWeekday(weekdayOfIso(cursor), week); guard += 1) {
    cursor = addDaysIso(cursor, 1);
  }
  return cursor;
}
