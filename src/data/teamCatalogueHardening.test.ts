import { describe, expect, it } from 'vitest';
import {
  ARCHIVED_CHAIR_MESSAGE,
  friendlyError,
  generateSlots,
  INVALID_WEEKDAY_MESSAGE,
  INVITE_LIMIT_MESSAGE,
  INVITES_PER_HOUR,
  weekdayOfIso,
  zonedParts,
} from '../domain';
import { createLocalRepository } from './localRepository';
import { memoryStore } from './storage';
import type { Repository } from './types';

const CLASSIQUE = '30000000-0000-4000-8000-000000000001';

function nextWeekday(weekday: number, extraWeeks = 0): string {
  const base = zonedParts(new Date()).isoDate;
  const [year, month, day] = base.split('-').map(Number);
  for (let offset = 3; offset < 20; offset += 1) {
    const next = new Date(Date.UTC(year, month - 1, day + offset + extraWeeks * 7));
    const iso = next.toISOString().slice(0, 10);
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
  const { id } = await data.createBarber({ fullName: 'Ousmane Diallo', shortName: 'Ousmane', weekdays: [2, 3, 4, 5, 6], serviceIds: [CLASSIQUE] });
  return { data, ousmane: id };
}

async function bookAsClient(data: Repository, barberId: string, date: string) {
  await data.signOut();
  await data.signIn('alex.gagnon@exemple.ca', 'nanometre');
  const slot = (await data.getSlots({ barberId, serviceId: CLASSIQUE, date })).find((item) => item.available);
  expect(slot).toBeDefined();
  const booking = await data.createBooking({
    serviceId: CLASSIQUE,
    barberId,
    date,
    startMinute: slot!.startMinute,
    paymentMethod: 'sur_place',
    redeemReward: false,
  });
  await data.signOut();
  await data.signIn('karim@lenanometre.ca', 'nanometre');
  return booking;
}

describe('durcissement équipe et catalogue (démo)', () => {
  it('M-2 : les créneaux suivent les heures réglées pour le salon', async () => {
    const { data, ousmane } = await owner();
    const date = nextWeekday(3);
    await data.updateSalonSettings({ openMinute: 600, closeMinute: 960, onsiteLatePolicy: 'aucun', force: true });
    const narrow = (await data.getSlots({ barberId: ousmane, serviceId: CLASSIQUE, date })).map((slot) => slot.startMinute);
    expect(narrow[0]).toBe(600);
    expect(narrow[narrow.length - 1]).toBe(930);
    await data.updateSalonSettings({ openMinute: 480, closeMinute: 1200, onsiteLatePolicy: 'aucun', force: true });
    const wide = await data.getSlots({ barberId: ousmane, serviceId: CLASSIQUE, date });
    expect(wide[0]).toMatchObject({ startMinute: 480, available: true });
    expect(wide[wide.length - 1].startMinute).toBe(1170);
    expect(generateSlots({ weekday: 3, durationMinutes: 30, openMinute: 600, closeMinute: 960 }).map((slot) => slot.startMinute).at(-1)).toBe(930);
  });

  it('F-3 : refuse le dimanche, le dernier jour et un jour avec des rendez-vous à venir', async () => {
    const { data, ousmane } = await owner();
    await expect(data.setBarberWeekday({ barberId: ousmane, weekday: 0, open: true })).rejects.toThrow(INVALID_WEEKDAY_MESSAGE);
    await expect(data.setBarberWeekday({ barberId: ousmane, weekday: 99, open: true })).rejects.toThrow(INVALID_WEEKDAY_MESSAGE);
    const wednesday = nextWeekday(3);
    await bookAsClient(data, ousmane, wednesday);
    await expect(data.setBarberWeekday({ barberId: ousmane, weekday: 3, open: false })).rejects.toThrow(
      'Ousmane a encore 1 rendez-vous à venir le mercredi.',
    );
    for (const weekday of [2, 4, 5]) {
      await data.setBarberWeekday({ barberId: ousmane, weekday, open: false });
    }
    await expect(data.setBarberWeekday({ barberId: ousmane, weekday: 6, open: false })).resolves.toBeUndefined();
    const setup = (await data.getBarberSetup()).find((item) => item.barberId === ousmane);
    expect(setup?.weekdays).toEqual([3]);
    const lonely = await data.createBarber({ fullName: 'Marc Lavoie', shortName: 'Marc', weekdays: [2], serviceIds: [CLASSIQUE] });
    await expect(data.setBarberWeekday({ barberId: lonely.id, weekday: 2, open: false })).rejects.toThrow('Marc doit garder au moins un jour de travail.');
  });

  it('F-2 : une chaise ne revient pas sans prestation active', async () => {
    const { data, ousmane } = await owner();
    await data.archiveBarber(ousmane);
    await data.setBarberService({ barberId: ousmane, serviceId: CLASSIQUE, eligible: false });
    await expect(data.reactivateBarber(ousmane)).rejects.toThrow('Ousmane n’offre plus aucune prestation active.');
    expect((await data.listManagedBarbers()).find((barber) => barber.id === ousmane)?.active).toBe(false);
    await data.setBarberService({ barberId: ousmane, serviceId: CLASSIQUE, eligible: true });
    await data.reactivateBarber(ousmane);
    expect((await data.listManagedBarbers()).find((barber) => barber.id === ousmane)?.active).toBe(true);
  });

  it('F-1 : un membre ne devient pas coiffeur sur une chaise retirée', async () => {
    const { data, ousmane } = await owner();
    await data.inviteMember({ fullName: 'Associé', email: 'associe@lenanometre.ca', role: 'proprietaire', barberId: ousmane });
    const associe = (await data.listTeam()).find((member) => member.email === 'associe@lenanometre.ca');
    await data.archiveBarber(ousmane);
    await expect(data.setMemberRole(associe!.id, 'coiffeur')).rejects.toThrow(ARCHIVED_CHAIR_MESSAGE);
    expect((await data.listTeam()).find((member) => member.id === associe!.id)?.role).toBe('proprietaire');
  });

  it('F-5 : plafonne les invitations par heure', async () => {
    const { data, ousmane } = await owner();
    for (let index = 0; index < INVITES_PER_HOUR; index += 1) {
      await data.inviteMember({ fullName: `Invité ${index}`, email: `invite${index}@lenanometre.ca`, role: 'proprietaire', barberId: null });
    }
    await expect(
      data.inviteMember({ fullName: 'Onzième', email: 'onze@lenanometre.ca', role: 'coiffeur', barberId: ousmane }),
    ).rejects.toThrow(INVITE_LIMIT_MESSAGE);
    expect((await data.listTeam()).some((member) => member.email === 'onze@lenanometre.ca')).toBe(false);
  });

  it('F-3 : un toast ne montre jamais un message brut de la base', () => {
    const raw = new Error('new row for relation "schedules" violates check constraint "schedules_weekday_check". Failing row contains (…)');
    expect(friendlyError(raw, 'Jour refusé.')).toBe('Jour refusé.');
    expect(friendlyError(new Error('duplicate key value violates unique constraint'), 'Jour refusé.')).toBe('Jour refusé.');
    expect(friendlyError(new Error(''), 'Jour refusé.')).toBe('Jour refusé.');
    expect(friendlyError('n’importe quoi', 'Jour refusé.')).toBe('n’importe quoi');
    expect(friendlyError(new Error(INVALID_WEEKDAY_MESSAGE), 'Jour refusé.')).toBe(INVALID_WEEKDAY_MESSAGE);
    expect(friendlyError(new Error('Ousmane doit garder au moins un jour de travail.'), 'Jour refusé.')).toBe(
      'Ousmane doit garder au moins un jour de travail.',
    );
  });
});
