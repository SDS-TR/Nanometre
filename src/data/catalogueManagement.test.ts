import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug, validateNewBarber, validateNewService, weekdayOfIso, zonedParts } from '../domain';
import { createLocalRepository } from './localRepository';
import { memoryStore } from './storage';
import type { Repository } from './types';

const CLASSIQUE = '30000000-0000-4000-8000-000000000001';

/** Prochain jour donné (2 = mardi), au moins 3 jours après aujourd’hui à Québec. */
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
  const store = memoryStore();
  const data = createLocalRepository(store);
  await data.ready;
  await data.signIn('karim@lenanometre.ca', 'nanometre');
  return { data, store };
}

async function bookAs(data: Repository, email: string, input: { barberId: string; serviceId: string; date: string }) {
  const previous = data.getSession();
  await data.signOut();
  await data.signIn(email, 'nanometre');
  const slots = await data.getSlots({ barberId: input.barberId, serviceId: input.serviceId, date: input.date });
  const slot = slots.find((item) => item.available);
  expect(slot).toBeDefined();
  const booking = await data.createBooking({
    serviceId: input.serviceId,
    barberId: input.barberId,
    date: input.date,
    startMinute: slot!.startMinute,
    paymentMethod: 'sur_place',
    redeemReward: false,
  });
  await data.signOut();
  if (previous) {
    await data.signIn(previous.email, 'nanometre');
  }
  return booking;
}

describe('règles du catalogue', () => {
  it('nettoie les noms et refuse les formulaires incomplets', () => {
    expect(slugify('Éloïse D’Amour-Côté')).toBe('eloise-d-amour-cote');
    expect(uniqueSlug('Noah', ['noah', 'noah-2'])).toBe('noah-3');
    const services = new Set([CLASSIQUE]);
    expect(() => validateNewBarber({ fullName: 'N', shortName: 'N', weekdays: [2], serviceIds: [CLASSIQUE] }, services)).toThrow('nom complet');
    expect(() => validateNewBarber({ fullName: 'Noah P', shortName: 'Noah', weekdays: [], serviceIds: [CLASSIQUE] }, services)).toThrow('jour');
    expect(() => validateNewBarber({ fullName: 'Noah P', shortName: 'Noah', weekdays: [7], serviceIds: [CLASSIQUE] }, services)).toThrow('jour');
    // Dimanche et lundi sont des jours de travail valides depuis les horaires du 12 octobre.
    expect(validateNewBarber({ fullName: 'Noah P', shortName: 'Noah', weekdays: [0, 1], serviceIds: [CLASSIQUE] }, services).weekdays).toEqual([0, 1]);
    expect(() => validateNewBarber({ fullName: 'Noah P', shortName: 'Noah', weekdays: [2], serviceIds: [] }, services)).toThrow('prestation');
    expect(validateNewBarber({ fullName: ' Noah P ', shortName: 'Noah', weekdays: [3, 2, 3], serviceIds: [CLASSIQUE] }, services)).toMatchObject({
      fullName: 'Noah P',
      weekdays: [2, 3],
      specialty: 'Coiffeur',
    });
    const barbers = new Set(['b1']);
    expect(() => validateNewService({ name: 'Coupe classique', durationMinutes: 30, priceCents: 3500, barberIds: ['b1'] }, barbers, ['Coupe classique'])).toThrow(
      'déjà ce nom',
    );
    expect(() => validateNewService({ name: 'Coupe longue', durationMinutes: 7, priceCents: 3500, barberIds: ['b1'] }, barbers, [])).toThrow('Durée');
    expect(() => validateNewService({ name: 'Coupe longue', durationMinutes: 45, priceCents: 3500, barberIds: ['b2'] }, barbers, [])).toThrow('coiffeur actif');
  });
});

describe('gestion des chaises en démo', () => {
  it('réserve la gestion au propriétaire', async () => {
    const data = createLocalRepository(memoryStore());
    await data.ready;
    await data.signIn('julien.morel@lenanometre.ca', 'nanometre');
    await expect(data.listManagedBarbers()).rejects.toThrow('Accès refusé');
    await expect(data.createBarber({ fullName: 'Noah Pelletier', shortName: 'Noah', weekdays: [2], serviceIds: [CLASSIQUE] })).rejects.toThrow('Accès refusé');
    await expect(data.archiveService(CLASSIQUE)).rejects.toThrow('Accès refusé');
    await data.signOut();
    await data.signIn('alex.gagnon@exemple.ca', 'nanometre');
    await expect(data.archiveBarber('20000000-0000-4000-8000-000000000003')).rejects.toThrow('Accès refusé');
  });

  it('ajoute un coiffeur réservable, garde la sauvegarde et lui lie un compte', async () => {
    const { data, store } = await owner();
    const { id } = await data.createBarber({ fullName: 'Noah Pelletier', shortName: 'Noah', weekdays: [2, 3], serviceIds: [CLASSIQUE] });
    const visible = (await data.getBarbers()).find((barber) => barber.id === id);
    expect(visible).toMatchObject({ fullName: 'Noah Pelletier', slug: 'noah-pelletier', photo: '', serviceIds: [CLASSIQUE] });
    const tuesday = await data.getSlots({ barberId: id, serviceId: CLASSIQUE, date: nextWeekday(2) });
    expect(tuesday.some((slot) => slot.available && slot.barberId === id)).toBe(true);
    const friday = await data.getSlots({ barberId: id, serviceId: CLASSIQUE, date: nextWeekday(5) });
    expect(friday.some((slot) => slot.available)).toBe(false);
    await data.inviteMember({ fullName: 'Noah Pelletier', email: 'noah@lenanometre.ca', role: 'coiffeur', barberId: id });
    expect((await data.listAudit()).some((entry) => entry.action === 'coiffeur_ajout')).toBe(true);

    const reloaded = createLocalRepository(store);
    await reloaded.ready;
    expect((await reloaded.getBarbers()).some((barber) => barber.id === id)).toBe(true);
    const managed = (await reloaded.listManagedBarbers()).find((barber) => barber.id === id);
    expect(managed).toMatchObject({ active: true, weekdays: [2, 3], accountCount: 1, upcomingCount: 0 });
  });

  it('bloque le retrait tant qu’il reste des rendez-vous, puis archive sans effacer', async () => {
    const { data, store } = await owner();
    const { id } = await data.createBarber({ fullName: 'Noah Pelletier', shortName: 'Noah', weekdays: [2, 3, 4, 5, 6], serviceIds: [CLASSIQUE] });
    await data.inviteMember({ fullName: 'Noah Pelletier', email: 'noah@lenanometre.ca', role: 'coiffeur', barberId: id });
    const booking = await bookAs(data, 'alex.gagnon@exemple.ca', { barberId: id, serviceId: CLASSIQUE, date: nextWeekday(3) });
    await expect(data.archiveBarber(id)).rejects.toThrow('Noah Pelletier a encore 1 rendez-vous à venir');
    expect((await data.getBarbers()).some((barber) => barber.id === id)).toBe(true);

    await data.cancelClientBooking(booking.id);
    const result = await data.archiveBarber(id);
    expect(result).toEqual({ deactivatedAccounts: 1 });
    expect((await data.getBarbers()).some((barber) => barber.id === id)).toBe(false);
    const slots = await data.getSlots({ barberId: id, serviceId: CLASSIQUE, date: nextWeekday(3, 1) });
    expect(slots.some((slot) => slot.available)).toBe(false);
    const any = await data.getSlots({ barberId: 'any', serviceId: CLASSIQUE, date: nextWeekday(3, 1) });
    expect(any.some((slot) => slot.barberId === id)).toBe(false);
    expect((await data.getBooking(booking.id)).barberName).toBe('Noah Pelletier');
    const team = (await data.listTeam()).find((member) => member.email === 'noah@lenanometre.ca');
    expect(team?.active).toBe(false);
    await expect(data.setMemberActive(team!.id, true)).rejects.toThrow('chaise de ce coiffeur est retirée');
    await expect(
      data.inviteMember({ fullName: 'Autre', email: 'autre@lenanometre.ca', role: 'coiffeur', barberId: id }),
    ).rejects.toThrow('retiré');
    expect((await data.listAudit())[0].action).toBe('coiffeur_retrait');

    await data.signOut();
    await expect(data.signIn('noah@lenanometre.ca', 'nanometre')).rejects.toThrow('désactivé');
    await data.signIn('alex.gagnon@exemple.ca', 'nanometre');
    await expect(
      data.createBooking({ serviceId: CLASSIQUE, barberId: id, date: nextWeekday(3, 1), startMinute: 600, paymentMethod: 'sur_place', redeemReward: false }),
    ).rejects.toThrow('inactif');
    await data.signOut();

    const reloaded = createLocalRepository(store);
    await reloaded.ready;
    await reloaded.signIn('karim@lenanometre.ca', 'nanometre');
    expect((await reloaded.listManagedBarbers()).find((barber) => barber.id === id)?.active).toBe(false);
    expect((await reloaded.getBooking(booking.id)).barberName).toBe('Noah Pelletier');
    await reloaded.reactivateBarber(id);
    expect((await reloaded.getBarbers()).some((barber) => barber.id === id)).toBe(true);
    await reloaded.setMemberActive(team!.id, true);
  });

  it('garde le propriétaire actif quand sa propre chaise est retirée', async () => {
    const { data } = await owner();
    const karim = '20000000-0000-4000-8000-000000000001';
    const upcoming = (await data.listManagedBarbers()).find((barber) => barber.id === karim)!.upcomingCount;
    if (upcoming > 0) {
      await expect(data.archiveBarber(karim)).rejects.toThrow(`${upcoming} rendez-vous à venir`);
      const today = zonedParts(new Date()).isoDate;
      for (let offset = 0; offset < 60; offset += 1) {
        const [y, m, d] = today.split('-').map(Number);
        const date = new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
        for (const entry of await data.getAgenda({ date, barberId: karim })) {
          if (entry.kind === 'booking' && entry.canCancel) {
            await data.cancelClientBooking(entry.id);
          }
        }
      }
    }
    expect(await data.archiveBarber(karim)).toEqual({ deactivatedAccounts: 0 });
    expect(data.getSession()?.role).toBe('proprietaire');
    expect((await data.listTeam()).find((member) => member.email === 'karim@lenanometre.ca')?.active).toBe(true);
  });
});

describe('gestion des prestations en démo', () => {
  it('ajoute une prestation pour certains coiffeurs seulement', async () => {
    const { data, store } = await owner();
    const julien = '20000000-0000-4000-8000-000000000002';
    const samuel = '20000000-0000-4000-8000-000000000003';
    const { id } = await data.createService({ name: 'Coupe longue', description: 'Mi-longs', durationMinutes: 45, priceCents: 4200, barberIds: [julien] });
    expect((await data.getServices()).find((service) => service.id === id)).toMatchObject({ name: 'Coupe longue', priceCents: 4200, durationMinutes: 45 });
    const barbers = await data.getBarbers();
    expect(barbers.find((barber) => barber.id === julien)?.serviceIds).toContain(id);
    expect(barbers.find((barber) => barber.id === samuel)?.serviceIds).not.toContain(id);
    expect(barbers.find((barber) => barber.id === samuel)?.serviceIds).toContain(CLASSIQUE);
    const managed = (await data.listManagedServices()).find((service) => service.id === id);
    expect(managed).toMatchObject({ active: true, barberIds: [julien], upcomingCount: 0 });
    const reloaded = createLocalRepository(store);
    await reloaded.ready;
    expect((await reloaded.getServices()).some((service) => service.id === id)).toBe(true);
  });

  it('bloque le retrait avec des rendez-vous ou un coiffeur sans autre prestation, et garde l’historique', async () => {
    const { data, store } = await owner();
    const { id: noah } = await data.createBarber({ fullName: 'Noah Pelletier', shortName: 'Noah', weekdays: [2, 3, 4, 5, 6], serviceIds: [CLASSIQUE] });
    const { id } = await data.createService({ name: 'Coupe longue', durationMinutes: 45, priceCents: 4200, barberIds: [noah] });
    await data.setBarberService({ barberId: noah, serviceId: CLASSIQUE, eligible: false });
    await expect(data.setBarberService({ barberId: noah, serviceId: id, eligible: false })).rejects.toThrow('au moins une prestation');
    await expect(data.archiveService(id)).rejects.toThrow('C’est la seule prestation de : Noah');
    await data.setBarberService({ barberId: noah, serviceId: CLASSIQUE, eligible: true });

    const booking = await bookAs(data, 'alex.gagnon@exemple.ca', { barberId: noah, serviceId: id, date: nextWeekday(4) });
    await expect(data.archiveService(id)).rejects.toThrow('« Coupe longue » a encore 1 rendez-vous à venir');
    await data.cancelClientBooking(booking.id);
    await data.archiveService(id);
    expect((await data.getServices()).some((service) => service.id === id)).toBe(false);
    await expect(data.getSlots({ barberId: 'any', serviceId: id, date: nextWeekday(4, 1) })).rejects.toThrow('Prestation introuvable');
    await expect(data.setBarberService({ barberId: noah, serviceId: id, eligible: true })).rejects.toThrow('retirée');
    const kept = await data.getBooking(booking.id);
    expect(kept).toMatchObject({ serviceName: 'Coupe longue', priceCents: 4200 });
    expect((await data.listAudit())[0].action).toBe('prestation_retrait');

    const reloaded = createLocalRepository(store);
    await reloaded.ready;
    await reloaded.signIn('karim@lenanometre.ca', 'nanometre');
    expect((await reloaded.listManagedServices()).find((service) => service.id === id)?.active).toBe(false);
    await reloaded.reactivateService(id);
    expect((await reloaded.getServices()).some((service) => service.id === id)).toBe(true);
  });

  it('garde au moins une prestation au catalogue', async () => {
    const { data } = await owner();
    const services = await data.listManagedServices();
    let refused: unknown = null;
    for (const service of services) {
      try {
        await data.archiveService(service.id);
      } catch (reason) {
        refused = reason;
      }
    }
    const left = (await data.listManagedServices()).filter((service) => service.active);
    expect(left.length).toBeGreaterThanOrEqual(1);
    expect(refused).toBeInstanceOf(Error);
    if (left.length === 1) {
      await expect(data.archiveService(left[0].id)).rejects.toThrow('Le catalogue doit garder au moins une prestation.');
    }
  });
});
