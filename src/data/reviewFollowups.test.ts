import { describe, expect, it } from 'vitest';
import {
  closedDayMessage,
  DEFAULT_SALON_DAY,
  hoursConflictMessage,
  defaultSalonWeek,
  demoRebaseDays,
  formatDateRange,
  nextOpenDate,
  parseClock,
  priceDraftState,
  reassignSummary,
  rebaseIso,
  salonWeekSummary,
  validateSalonWeek,
  weekdayOfIso,
  zonedParts,
} from '../domain';
import { createLocalRepository } from './localRepository';
import { memoryStore } from './storage';
import type { Repository } from './types';

const CLASSIQUE = '30000000-0000-4000-8000-000000000001';

function nextWeekday(weekday: number): string {
  const base = zonedParts(new Date()).isoDate;
  const [year, month, day] = base.split('-').map(Number);
  for (let offset = 3; offset < 20; offset += 1) {
    const iso = new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
    if (weekdayOfIso(iso) === weekday) {
      return iso;
    }
  }
  throw new Error('date introuvable');
}

async function owner() {
  const data = createLocalRepository(memoryStore());
  await data.ready;
  await data.signIn('karim@lenanometre.ca', 'nanometre');
  return data;
}

async function book(data: Repository, barberId: string, date: string, startMinute?: number) {
  await data.signOut();
  await data.signIn('alex.gagnon@exemple.ca', 'nanometre');
  const slots = await data.getSlots({ barberId, serviceId: CLASSIQUE, date });
  const slot = startMinute === undefined ? slots.find((item) => item.available) : slots.find((item) => item.startMinute === startMinute);
  expect(slot?.available).toBe(true);
  const booking = await data.createBooking({ serviceId: CLASSIQUE, barberId, date, startMinute: slot!.startMinute, paymentMethod: 'sur_place', redeemReward: false });
  await data.signOut();
  await data.signIn('karim@lenanometre.ca', 'nanometre');
  return booking;
}

describe('suivis de la revue du 12 octobre (domaine)', () => {
  it('décale le seed de démo d’un nombre entier de semaines', () => {
    expect(demoRebaseDays('2026-10-01')).toBe(0);
    expect(demoRebaseDays('2026-10-06')).toBe(0);
    expect(demoRebaseDays('2026-10-07')).toBe(7);
    expect(demoRebaseDays('2026-10-12')).toBe(7);
    expect(demoRebaseDays('2026-10-13')).toBe(7);
    expect(rebaseIso('2026-10-06', 7)).toBe('2026-10-13');
    expect(weekdayOfIso(rebaseIso('2026-10-06', demoRebaseDays('2026-12-25')))).toBe(2);
  });

  it('affiche les périodes du tableau en français', () => {
    expect(formatDateRange('2026-10-12', '2026-10-12')).toMatch(/^12 oct\.?$/);
    expect(formatDateRange('2026-10-06', '2026-10-10')).toMatch(/^du 6 oct\.? au 10 oct\.?$/);
    expect(formatDateRange('2026-09-13', '2026-10-12')).not.toMatch(/\d{4}-/);
  });

  it('garde l’erreur de prix sous le champ et n’active Enregistrer qu’au changement', () => {
    expect(priceDraftState(undefined, 3500)).toEqual({ changed: false, cents: 3500, error: null });
    expect(priceDraftState('35,00', 3500)).toEqual({ changed: false, cents: 3500, error: null });
    expect(priceDraftState('38', 3500)).toEqual({ changed: true, cents: 3800, error: null });
    expect(priceDraftState('abc', 3500).error).toBe('Tarif invalide. Exemple : 35,00');
    expect(priceDraftState(' ', 3500).error).toBe('Indique un prix. Exemple : 35,00');
  });

  it('horaires : validation, résumé, jour fermé seulement si le propriétaire l’a fermé', () => {
    const week = defaultSalonWeek();
    expect(week).toHaveLength(7);
    expect(salonWeekSummary(week)).toEqual(['Ouvert 7 jours sur 7, 24 h sur 24']);
    expect(closedDayMessage('2026-10-12', week)).toBeNull();
    expect(closedDayMessage('2026-10-12', null)).toBeNull();
    const closedMonday = week.map((day) => (day.weekday === 1 ? { ...day, open: false } : day));
    expect(closedDayMessage('2026-10-12', closedMonday)).toBe('Salon fermé le lundi.');
    expect(nextOpenDate('2026-10-11', closedMonday)).toBe('2026-10-13');
    expect(salonWeekSummary(closedMonday)[0]).toBe('Lundi : fermé');
    expect(() => validateSalonWeek(week.map((day) => (day.weekday === 3 ? { ...day, openMinute: 900, closeMinute: 600 } : day)))).toThrow(
      'L’heure de fermeture doit suivre l’heure d’ouverture.',
    );
    expect(() => validateSalonWeek(week.map((day) => ({ ...day, open: false })))).toThrow('Le salon doit ouvrir au moins un jour.');
    expect(parseClock('9 h 30')).toBe(570);
    expect(parseClock('24:00')).toBe(1440);
    expect(() => parseClock('9:10')).toThrow('Heure invalide.');
  });

  it('résume une réassignation en phrase', () => {
    expect(reassignSummary({ moved: 2, kept: 0 }, 'Sami', 'Amine')).toBe('2 rendez-vous passent à Sami. Les clients sont avisés.');
    expect(reassignSummary({ moved: 0, kept: 1 }, 'Sami', 'Amine')).toMatch(/^Aucun rendez-vous n’a pu passer à Sami\. 1 reste à Amine/);
  });
});

describe('suivis de la revue du 12 octobre (démo locale)', () => {
  it('rebase les rendez-vous de démo sur la date du jour et garde le décalage', async () => {
    const store = memoryStore();
    const early = createLocalRepository(store, { now: () => new Date('2026-10-06T16:00:00Z') });
    await early.ready;
    await early.signIn('karim@lenanometre.ca', 'nanometre');
    const before = await early.getDashboard({ anchor: '2026-10-06', period: 'jour' });
    const later = createLocalRepository(store, { now: () => new Date('2026-10-20T16:00:00Z') });
    await later.ready;
    await later.signIn('karim@lenanometre.ca', 'nanometre');
    const after = await later.getDashboard({ anchor: '2026-10-20', period: 'jour' });
    expect(after.booked).toBe(before.booked);
    expect(after.booked).toBeGreaterThan(0);
  });

  it('horaires du salon : refuse un conflit sans « quand même », puis ferme le jour', async () => {
    const data = await owner();
    expect((await data.getSalon()).week).toHaveLength(7);
    const barberId = (await data.listManagedBarbers()).find((barber) => barber.active)!.id;
    const sunday = nextWeekday(0);
    await book(data, barberId, sunday);
    const closedSunday = defaultSalonWeek().map((day) => (day.weekday === 0 ? { ...day, open: false } : day));
    await expect(data.setSalonHours({ week: closedSunday })).rejects.toThrow(/sortent des nouvelles heures/);
    const salon = await data.setSalonHours({ week: closedSunday, force: true });
    expect(salon.week?.find((day) => day.weekday === 0)?.open).toBe(false);
    expect(await data.getSlots({ barberId, serviceId: CLASSIQUE, date: sunday })).toEqual([]);
    const audit = await data.listAudit();
    expect(audit.some((entry) => entry.action === 'salon_horaires')).toBe(true);
  });

  it('modifie une prestation et garde l’historique des prix', async () => {
    const data = await owner();
    await data.updateService({ serviceId: CLASSIQUE, priceCents: 3800 });
    await data.updateService({ serviceId: CLASSIQUE, priceCents: 4000 });
    const history = await data.listPriceHistory(CLASSIQUE);
    expect(history.map((entry) => [entry.oldCents, entry.newCents])).toEqual([
      [3800, 4000],
      [3500, 3800],
    ]);
    await data.updateServiceDetails({ serviceId: CLASSIQUE, name: ' Coupe classique plus ', description: 'Ciseaux', durationMinutes: 40 });
    const service = (await data.getServices()).find((item) => item.id === CLASSIQUE);
    expect(service).toMatchObject({ name: 'Coupe classique plus', durationMinutes: 40 });
    await expect(data.updateServiceDetails({ serviceId: CLASSIQUE, name: 'Coupe classique plus', description: '', durationMinutes: 7 })).rejects.toThrow(/^Durée invalide/);
  });

  it('réassigne les rendez-vous à venir d’un coiffeur avant de le retirer', async () => {
    const data = await owner();
    const amine = (await data.createBarber({ fullName: 'Amine Revue', shortName: 'Amine', weekdays: [0, 1, 2, 3, 4, 5, 6], serviceIds: [CLASSIQUE] })).id;
    const sami = (await data.createBarber({ fullName: 'Sami Revue', shortName: 'Sami', weekdays: [0, 1, 2, 3, 4, 5, 6], serviceIds: [CLASSIQUE] })).id;
    const date = nextWeekday(4);
    await book(data, amine, date, 600);
    await expect(data.reassignBarberBookings({ fromBarberId: amine, toBarberId: amine })).rejects.toThrow('Choisis un autre coiffeur actif.');
    expect(await data.reassignBarberBookings({ fromBarberId: amine, toBarberId: sami })).toEqual({ moved: 1, kept: 0 });
    await expect(data.archiveBarber(amine)).resolves.not.toThrow();
  });

  it('défaut documenté 7 jours 00:00–24:00 ; message de conflit avec le total réel (F-1)', () => {
    expect(DEFAULT_SALON_DAY).toEqual({ open: true, openMinute: 0, closeMinute: 1440 });
    expect(defaultSalonWeek().every((day) => day.open && day.openMinute === 0 && day.closeMinute === 1440)).toBe(true);
    const ids = Array.from({ length: 12 }, (_, index) => `id${index}`);
    const message = hoursConflictMessage(ids);
    expect(message).toMatch(/\(12\)/);
    expect(message.split('Identifiants : ')[1].replace(/\.$/, '').split(', ')).toHaveLength(8);
  });

  it('réassignation : respecte les heures du salon ; forcé, le journal compte les rendez-vous maintenus (M-2, F-2)', async () => {
    const data = await owner();
    const amine = (await data.createBarber({ fullName: 'Amine Heures', shortName: 'Amine', weekdays: [0, 1, 2, 3, 4, 5, 6], serviceIds: [CLASSIQUE] })).id;
    const sami = (await data.createBarber({ fullName: 'Sami Heures', shortName: 'Sami', weekdays: [0, 1, 2, 3, 4, 5, 6], serviceIds: [CLASSIQUE] })).id;
    const date = nextWeekday(4);
    await book(data, amine, date, 600);
    const shortThursday = defaultSalonWeek().map((day) => (day.weekday === 4 ? { ...day, openMinute: 0, closeMinute: 540 } : day));
    await data.setSalonHours({ week: shortThursday, force: true });
    const audit = await data.listAudit();
    expect(audit.some((entry) => entry.action === 'salon_horaires' && /\d+ rendez-vous hors horaires maintenus/.test(entry.detail))).toBe(true);
    expect(await data.reassignBarberBookings({ fromBarberId: amine, toBarberId: sami })).toEqual({ moved: 0, kept: 1 });
  });

  it('réinitialise la démo', async () => {
    const data = await owner();
    await data.updateService({ serviceId: CLASSIQUE, priceCents: 4100 });
    await data.resetDemo!();
    expect((await data.getServices()).find((item) => item.id === CLASSIQUE)?.priceCents).toBe(3500);
    expect(await data.listPriceHistory(CLASSIQUE)).toEqual([]);
  });
});
