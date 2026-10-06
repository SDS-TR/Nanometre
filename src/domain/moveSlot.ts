import { occupancyMinutes, STEP_MINUTES } from './slots';
import { weekdayOfIso, zonedDateTime } from './zonedTime';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type MoveCheck = {
  date: string;
  startMinute: number;
  durationMinutes: number;
  openMinute: number;
  closeMinute: number;
  /** Jours où CE coiffeur travaille. Le salon reste fermé dimanche et lundi. */
  openWeekdays: number[];
  eligible: boolean;
  busy: { start: number; end: number }[];
  blocked: { start: number; end: number }[];
  now?: Date;
};

function overlaps(start: number, end: number, intervals: { start: number; end: number }[]): boolean {
  return intervals.some((interval) => start < interval.end && interval.start < end);
}

/** Refuse le déplacement avant toute écriture. Les messages sont en français. */
export function assertMovableSlot(input: MoveCheck): void {
  if (!ISO_DATE.test(input.date) || Number.isNaN(Date.parse(`${input.date}T12:00:00Z`))) {
    throw new Error('Date invalide.');
  }
  const [year, month, day] = input.date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error('Date invalide.');
  }
  if (!Number.isInteger(input.startMinute) || input.startMinute % STEP_MINUTES !== 0) {
    throw new Error('Heure invalide.');
  }
  if (!input.eligible) {
    throw new Error('Ce coiffeur ne fait pas cette prestation.');
  }
  const weekday = weekdayOfIso(input.date);
  if (weekday < 2 || weekday > 6 || !input.openWeekdays.includes(weekday)) {
    throw new Error('Le salon est fermé ce jour-là.');
  }
  const occupancy = occupancyMinutes(input.durationMinutes);
  if (input.startMinute < input.openMinute || input.startMinute + occupancy > input.closeMinute) {
    throw new Error('Ce créneau est hors des heures d’ouverture.');
  }
  const starts = zonedDateTime(input.date, input.startMinute);
  if (Number.isNaN(starts.getTime()) || starts.getTime() <= (input.now ?? new Date()).getTime()) {
    throw new Error('Ce créneau est déjà passé.');
  }
  const end = input.startMinute + occupancy;
  if (overlaps(input.startMinute, end, input.blocked) || overlaps(input.startMinute, end, input.busy)) {
    throw new Error('Ce créneau n’est pas libre.');
  }
}
