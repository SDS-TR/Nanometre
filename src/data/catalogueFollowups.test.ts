import { describe, expect, it } from 'vitest';
import { reactivateServiceWithoutBarberMessage, upcomingBarberServiceMessage, weekdayOfIso, zonedParts } from '../domain';
import { createLocalRepository } from './localRepository';
import { memoryStore } from './storage';
import type { Repository } from './types';

const CLASSIQUE = '30000000-0000-4000-8000-000000000001';

function nextWeekday(weekday: number): string {
  const [year, month, day] = zonedParts(new Date()).isoDate.split('-').map(Number);
  for (let offset = 3; offset < 20; offset += 1) {
    const iso = new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
    if (weekdayOfIso(iso) === weekday) {
      return iso;
    }
  }
  throw new Error('date introuvable');
}

async function setup() {
  const data = createLocalRepository(memoryStore());
  await data.ready;
  await data.signIn('karim@lenanometre.ca', 'nanometre');
  const ousmane = (await data.createBarber({ fullName: 'Ousmane Diallo', shortName: 'Ousmane', weekdays: [2, 3, 4, 5, 6], serviceIds: [CLASSIQUE] })).id;
  const rasage = (await data.createService({ name: 'Rasage test', durationMinutes: 30, priceCents: 2500, barberIds: [ousmane] })).id;
  return { data, ousmane, rasage };
}

async function asClient<T>(data: Repository, task: () => Promise<T>): Promise<T> {
  await data.signOut();
  await data.signIn('alex.gagnon@exemple.ca', 'nanometre');
  try {
    return await task();
  } finally {
    await data.signOut();
    await data.signIn('karim@lenanometre.ca', 'nanometre');
  }
}

describe('suivis du catalogue (démo)', () => {
  it('N-1 : refuse de retirer une prestation qu’un coiffeur doit encore faire, avec le nombre', async () => {
    const { data, ousmane, rasage } = await setup();
    const date = nextWeekday(4);
    const booking = await asClient(data, async () => {
      const slot = (await data.getSlots({ barberId: ousmane, serviceId: CLASSIQUE, date })).find((item) => item.available);
      return data.createBooking({ serviceId: CLASSIQUE, barberId: ousmane, date, startMinute: slot!.startMinute, paymentMethod: 'sur_place', redeemReward: false });
    });
    await expect(data.setBarberService({ barberId: ousmane, serviceId: CLASSIQUE, eligible: false })).rejects.toThrow(
      upcomingBarberServiceMessage('Ousmane', 1, 'Coupe classique'),
    );
    expect((await data.getBarberSetup()).find((item) => item.barberId === ousmane)?.serviceIds).toContain(CLASSIQUE);
    // Le rendez-vous reste déplaçable : la prestation est toujours liée au coiffeur.
    const later = nextWeekday(5);
    await data.moveBooking({ bookingId: booking.id, date: later, startMinute: 600 });
    // Une prestation sans rendez-vous à venir se retire normalement, et c’est journalisé.
    await data.setBarberService({ barberId: ousmane, serviceId: rasage, eligible: false });
    const audit = await data.listAudit();
    expect(audit.some((entry) => entry.action === 'coiffeur_prestation' && entry.detail.includes('Rasage test'))).toBe(true);
    await data.setBarberService({ barberId: ousmane, serviceId: rasage, eligible: true });
    // Un rendez-vous annulé ne bloque plus le retrait.
    await asClient(data, () => data.cancelBooking(booking.id));
    await data.setBarberService({ barberId: ousmane, serviceId: CLASSIQUE, eligible: false });
    expect((await data.getBarberSetup()).find((item) => item.barberId === ousmane)?.serviceIds).not.toContain(CLASSIQUE);
  });

  it('N-4 : une prestation ne revient pas sans coiffeur actif, sauf si on en choisit', async () => {
    const { data, ousmane, rasage } = await setup();
    await data.archiveService(rasage);
    await data.archiveBarber(ousmane);
    await expect(data.reactivateService(rasage)).rejects.toThrow(reactivateServiceWithoutBarberMessage('Rasage test'));
    await expect(data.reactivateService(rasage, [ousmane])).rejects.toThrow('Choisis au moins un coiffeur actif pour cette prestation.');
    await expect(data.reactivateService(rasage, ['inconnu'])).rejects.toThrow('Choisis au moins un coiffeur actif pour cette prestation.');
    expect((await data.listManagedServices()).find((service) => service.id === rasage)?.active).toBe(false);

    const julien = (await data.listManagedBarbers()).find((barber) => barber.active && barber.shortName === 'Julien');
    expect(julien).toBeDefined();
    await data.reactivateService(rasage, [julien!.id]);
    const revived = (await data.listManagedServices()).find((service) => service.id === rasage);
    expect(revived?.active).toBe(true);
    expect(revived?.barberIds).toContain(julien!.id);
    const slots = await data.getSlots({ barberId: julien!.id, serviceId: rasage, date: nextWeekday(4) });
    expect(slots.some((slot) => slot.available)).toBe(true);
    await expect(data.reactivateService(rasage)).rejects.toThrow('Cette prestation est déjà active.');
  });

  it('N-4 : sans choix, la réactivation passe si un coiffeur actif la fait déjà', async () => {
    const { data, rasage } = await setup();
    await data.archiveService(rasage);
    await data.reactivateService(rasage);
    expect((await data.listManagedServices()).find((service) => service.id === rasage)?.active).toBe(true);
  });
});
