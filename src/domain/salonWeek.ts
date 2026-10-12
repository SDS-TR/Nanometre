import { formatTime } from './format';

/** Un jour de la semaine du salon. Dimanche = 0 … samedi = 6. */
export type SalonDay = { weekday: number; open: boolean; openMinute: number; closeMinute: number };

export const DAY_MINUTES = 24 * 60;
export const ALL_WEEKDAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

const LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;
/** Ordre d’affichage : lundi d’abord. */
export const WEEK_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

export function weekdayLong(weekday: number): string {
  return LONG[weekday] ?? 'jour';
}

/** Par défaut : ouvert 7 jours sur 7, toute la journée (0 h à 24 h). */
export function defaultSalonWeek(): SalonDay[] {
  return ALL_WEEKDAYS.map((weekday) => ({ weekday, open: true, openMinute: 0, closeMinute: DAY_MINUTES }));
}

/** Heures du jour, ou null si le propriétaire a fermé ce jour-là. Sans semaine : ouvert toute la journée. */
export function salonDayHours(weekday: number, week?: readonly SalonDay[] | null): { openMinute: number; closeMinute: number } | null {
  const day = (week ?? defaultSalonWeek()).find((item) => item.weekday === weekday);
  if (!day) {
    return week ? null : { openMinute: 0, closeMinute: DAY_MINUTES };
  }
  return day.open ? { openMinute: day.openMinute, closeMinute: day.closeMinute } : null;
}

export function isSalonOpen(weekday: number, week?: readonly SalonDay[] | null): boolean {
  return salonDayHours(weekday, week) !== null;
}

/** Mêmes textes que admin_set_salon_hours. */
export const SALON_HOURS_MESSAGES = {
  invalid: 'Réglage invalide.',
  order: 'L’heure de fermeture doit suivre l’heure d’ouverture.',
  noDay: 'Le salon doit ouvrir au moins un jour.',
} as const;

/** Valide et normalise les 7 jours. Heures au quart d’heure, 0 h à 24 h, fermeture après ouverture. */
export function validateSalonWeek(week: readonly SalonDay[]): SalonDay[] {
  const byDay = new Map(week.map((day) => [day.weekday, day]));
  if (week.length !== 7 || byDay.size !== 7 || ALL_WEEKDAYS.some((weekday) => !byDay.has(weekday))) {
    throw new Error(SALON_HOURS_MESSAGES.invalid);
  }
  const clean = ALL_WEEKDAYS.map((weekday) => {
    const day = byDay.get(weekday)!;
    const aligned =
      Number.isInteger(day.openMinute) &&
      Number.isInteger(day.closeMinute) &&
      day.openMinute >= 0 &&
      day.closeMinute <= DAY_MINUTES &&
      day.openMinute % 15 === 0 &&
      day.closeMinute % 15 === 0;
    if (!aligned) {
      throw new Error(SALON_HOURS_MESSAGES.invalid);
    }
    if (day.open && day.closeMinute <= day.openMinute) {
      throw new Error(SALON_HOURS_MESSAGES.order);
    }
    return { weekday, open: Boolean(day.open), openMinute: day.openMinute, closeMinute: day.closeMinute };
  });
  if (!clean.some((day) => day.open)) {
    throw new Error(SALON_HOURS_MESSAGES.noDay);
  }
  return clean;
}

/** « 9 h 00 à 19 h 00 », ou « 24 h sur 24 ». */
export function dayHoursLabel(openMinute: number, closeMinute: number): string {
  if (openMinute === 0 && closeMinute === DAY_MINUTES) {
    return '24 h sur 24';
  }
  return `${formatTime(openMinute)} à ${closeMinute === DAY_MINUTES ? 'minuit' : formatTime(closeMinute)}`;
}

/** Résumé pour l’accueil : « Ouvert 7 jours sur 7, 24 h sur 24 » ou une ligne par jour. */
export function salonWeekSummary(week: readonly SalonDay[] | null | undefined): string[] {
  const days = WEEK_ORDER.map((weekday) => (week ?? defaultSalonWeek()).find((day) => day.weekday === weekday)).filter(
    (day): day is SalonDay => Boolean(day),
  );
  const open = days.filter((day) => day.open);
  if (open.length === 0) {
    return ['Fermé'];
  }
  const same = open.every((day) => day.openMinute === open[0].openMinute && day.closeMinute === open[0].closeMinute);
  if (open.length === 7 && same) {
    return [`Ouvert 7 jours sur 7, ${dayHoursLabel(open[0].openMinute, open[0].closeMinute)}`];
  }
  return days.map((day) => `${weekdayLong(day.weekday).replace(/^./, (c) => c.toUpperCase())} : ${day.open ? dayHoursLabel(day.openMinute, day.closeMinute) : 'fermé'}`);
}

/** « 14:30 » ou « 14 h 30 » ou « 14h » → minutes. 24:00 accepté pour la fermeture. */
export function parseClock(raw: string): number {
  const match = /^\s*(\d{1,2})\s*(?:h|:)\s*(\d{2})?\s*$/i.exec(raw) ?? /^\s*(\d{1,2})\s*$/.exec(raw);
  if (!match) {
    throw new Error('Heure invalide.');
  }
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const total = hour * 60 + minute;
  if (hour > 24 || minute > 59 || total > DAY_MINUTES || minute % 15 !== 0) {
    throw new Error('Heure invalide.');
  }
  return total;
}

/** Saisie affichée dans le champ : « 09:00 », « 24:00 ». */
export function clockInput(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Rendez-vous à venir hors des nouvelles heures (jour fermé ou heures plus courtes). */
export function futureOutsideWeek(
  bookings: { id: string; weekday: number; startMinute: number; durationMinutes: number }[],
  week: readonly SalonDay[],
): string[] {
  return bookings
    .filter((booking) => {
      const hours = salonDayHours(booking.weekday, week);
      return !hours || booking.startMinute < hours.openMinute || booking.startMinute + booking.durationMinutes > hours.closeMinute;
    })
    .map((booking) => booking.id);
}
