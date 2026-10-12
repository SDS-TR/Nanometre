import { describe, expect, it } from 'vitest';
import { openDaysPhrase } from './format';
import { defaultSalonWeek, salonWeekSummary } from './salonWeek';
import { freeSlots, generateSlots, isOpenWeekday, occupancyMinutes, OPEN_WEEKDAYS } from './slots';

/** Julien Morel, mardi 6 oct. 2026, sans le rendez-vous en cours d’Alex (14 h 30). */
const julienBusy = [
  { start: 540, end: 600 },
  { start: 615, end: 675 },
  { start: 675, end: 695 },
  { start: 705, end: 735 },
  { start: 735, end: 795 },
  { start: 795, end: 825 },
  { start: 825, end: 855 },
  { start: 960, end: 1020 },
  { start: 1020, end: 1080 },
  { start: 1095, end: 1115 },
];

describe('créneaux', () => {
  it('arrondit 20 min au palier de 30', () => {
    expect(occupancyMinutes(20)).toBe(30);
    expect(occupancyMinutes(30)).toBe(30);
    expect(occupancyMinutes(45)).toBe(45);
    expect(occupancyMinutes(60)).toBe(60);
  });

  it('ouvre 7 jours sur 7 par défaut et ferme seulement les jours que le propriétaire ferme', () => {
    expect(generateSlots({ weekday: 0, durationMinutes: 30 }).length).toBeGreaterThan(0);
    expect(generateSlots({ weekday: 1, durationMinutes: 30 }).length).toBeGreaterThan(0);
    const week = defaultSalonWeek().map((day) => (day.weekday === 1 ? { ...day, open: false } : day));
    expect(generateSlots({ weekday: 1, durationMinutes: 30, week })).toEqual([]);
    // Toute la journée par défaut : 96 départs de 15 min pour 15 min de prestation.
    const all = generateSlots({ weekday: 3, durationMinutes: 15, week: defaultSalonWeek() });
    expect(all[0].startMinute).toBe(0);
    expect(all.at(-1)?.startMinute).toBe(24 * 60 - 15);
    expect(all).toHaveLength(96);
    // Heures du jour : la semaine prime sur les heures globales.
    const short = defaultSalonWeek().map((day) => (day.weekday === 3 ? { ...day, openMinute: 600, closeMinute: 660 } : day));
    expect(generateSlots({ weekday: 3, durationMinutes: 30, week: short, openMinute: 0, closeMinute: 1440 }).map((slot) => slot.startMinute)).toEqual([600, 615, 630]);
  });

  it('publie les mêmes jours ouverts que la phrase d’accueil', () => {
    expect([...OPEN_WEEKDAYS]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (let day = 0; day <= 6; day += 1) {
      expect(isOpenWeekday(day)).toBe(true);
    }
    expect(openDaysPhrase([...OPEN_WEEKDAYS])).toBe('Du dimanche au samedi');
    expect(salonWeekSummary(defaultSalonWeek())).toEqual(['Ouvert 7 jours sur 7, 24 h sur 24']);
  });

  it('aligne les départs sur 15 min et rien ne dépasse 19 h', () => {
    const slots = generateSlots({ weekday: 2, durationMinutes: 60 });
    expect(slots[0].startMinute).toBe(9 * 60);
    expect(slots[slots.length - 1].startMinute).toBe(18 * 60);
    expect(slots.every((slot) => slot.occupancyEndMinute <= 19 * 60)).toBe(true);
    const beard = generateSlots({ weekday: 2, durationMinutes: 20 });
    expect(beard[beard.length - 1].startMinute).toBe(18 * 60 + 30);
    expect(beard[beard.length - 1].endMinute).toBe(18 * 60 + 50);
  });

  it('reproduit les trous de Julien le 6 octobre', () => {
    const hour = (value: number) => value;
    expect(freeSlots(generateSlots({ weekday: 2, durationMinutes: 60, busy: julienBusy })).map((slot) => slot.startMinute)).toEqual([
      hour(14 * 60 + 15),
      hour(14 * 60 + 30),
      hour(14 * 60 + 45),
      hour(15 * 60),
    ]);
    expect(freeSlots(generateSlots({ weekday: 2, durationMinutes: 45, busy: julienBusy }))).toHaveLength(5);
    expect(freeSlots(generateSlots({ weekday: 2, durationMinutes: 30, busy: julienBusy }))).toHaveLength(6);
    const selected = generateSlots({ weekday: 2, durationMinutes: 60, busy: julienBusy }).find(
      (slot) => slot.startMinute === 14 * 60 + 30,
    );
    expect(selected?.endMinute).toBe(15 * 60 + 30);
  });

  it('respecte un blocage admin sur la fin de journée', () => {
    const slots = freeSlots(
      generateSlots({
        weekday: 3,
        durationMinutes: 30,
        blocked: [{ start: 18 * 60 + 30, end: 19 * 60 }],
      }),
    );
    expect(slots.some((slot) => slot.startMinute === 18 * 60 + 30)).toBe(false);
    expect(slots.some((slot) => slot.startMinute === 18 * 60)).toBe(true);
  });
});
