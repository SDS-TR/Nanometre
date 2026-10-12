import { isSalonOpen, salonDayHours, type SalonDay } from './salonWeek';

export const OPEN_MINUTE = 9 * 60;
export const CLOSE_MINUTE = 19 * 60;
export const STEP_MINUTES = 15;

export type Interval = {
  start: number;
  end: number;
};

export type Slot = {
  startMinute: number;
  /** Fin affichée : début + durée réelle de la prestation. */
  endMinute: number;
  /** Fin du palier occupé (durée arrondie au multiple de 15 min). */
  occupancyEndMinute: number;
  available: boolean;
};

/** 20 min → palier 30. Les autres durées du salon tombent déjà sur la grille. */
export function occupancyMinutes(durationMinutes: number): number {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error('Durée invalide');
  }
  return Math.ceil(durationMinutes / STEP_MINUTES) * STEP_MINUTES;
}

/** Dimanche = 0 … samedi = 6. Par défaut, le salon ouvre 7 jours sur 7 ; le propriétaire ferme des jours dans Horaires. */
export const OPEN_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Sans semaine : tous les jours. Avec la semaine du salon : les jours que le propriétaire a laissés ouverts. */
export function isOpenWeekday(weekday: number, week?: readonly SalonDay[] | null): boolean {
  return week ? isSalonOpen(weekday, week) : OPEN_WEEKDAYS.some((day) => day === weekday);
}

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Créneaux de 15 min, fin de palier au plus tard à 19 h.
 * Les rendez-vous existants bloquent leur durée réelle ; le créneau demandé
 * a besoin de son palier entier (20 min → 30).
 */
export function generateSlots(input: {
  weekday: number;
  durationMinutes: number;
  busy?: Interval[];
  blocked?: Interval[];
  /** Si le jour est aujourd'hui, les départs déjà passés sont indisponibles. */
  earliestStartMinute?: number;
  openMinute?: number;
  closeMinute?: number;
  /** Semaine du salon : jour fermé = aucun créneau, sinon les heures de ce jour. */
  week?: readonly SalonDay[] | null;
}): Slot[] {
  if (!isOpenWeekday(input.weekday, input.week)) {
    return [];
  }
  const day = input.week ? salonDayHours(input.weekday, input.week) : null;
  const openMinute = day?.openMinute ?? input.openMinute ?? OPEN_MINUTE;
  const closeMinute = day?.closeMinute ?? input.closeMinute ?? CLOSE_MINUTE;
  const occupancy = occupancyMinutes(input.durationMinutes);
  const lastStart = closeMinute - occupancy;
  const busy = [...(input.busy ?? []), ...(input.blocked ?? [])];
  const slots: Slot[] = [];
  for (let start = openMinute; start <= lastStart; start += STEP_MINUTES) {
    const occupancyEnd = start + occupancy;
    const window = { start, end: occupancyEnd };
    const overlaps = busy.some((interval) => intervalsOverlap(window, interval));
    const tooEarly = input.earliestStartMinute != null && start < input.earliestStartMinute;
    slots.push({
      startMinute: start,
      endMinute: start + input.durationMinutes,
      occupancyEndMinute: occupancyEnd,
      available: !overlaps && !tooEarly,
    });
  }
  return slots;
}

export function freeSlots(slots: Slot[]): Slot[] {
  return slots.filter((slot) => slot.available);
}
