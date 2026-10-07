import { describe, expect, it } from 'vitest';
import { createLocalRepository } from '../data/localRepository';
import { memoryStore } from '../data/storage';
import { futureOutsideHours, hoursConflictMessage } from './salonHours';

const JULIEN = '20000000-0000-4000-8000-000000000002';
const JULIEN_USER = '33333333-3333-4333-8333-333333333333';

describe('non-régression locale', () => {
  it('refuse une réservation un jour de congé et chez un coiffeur inactif', async () => {
    const off = createLocalRepository(memoryStore());
    await off.ready;
    await off.signIn('karim@lenanometre.ca', 'nanometre');
    await off.setBarberWeekday({ barberId: JULIEN, weekday: 5, open: false });
    await off.signOut();
    await off.signIn('alex.gagnon@exemple.ca', 'nanometre');
    const service = (await off.getServices()).find((item) => item.name === 'Coupe classique');
    await expect(
      off.createBooking({
        serviceId: service!.id,
        barberId: JULIEN,
        date: '2026-10-16',
        startMinute: 11 * 60,
        paymentMethod: 'sur_place',
        redeemReward: false,
        promoCode: null,
      }),
    ).rejects.toThrow(/ne travaille pas/);

    const inactive = createLocalRepository(memoryStore());
    await inactive.ready;
    await inactive.signIn('karim@lenanometre.ca', 'nanometre');
    await inactive.setMemberActive(JULIEN_USER, false);
    await inactive.signOut();
    await inactive.signIn('alex.gagnon@exemple.ca', 'nanometre');
    await expect(
      inactive.createBooking({
        serviceId: service!.id,
        barberId: JULIEN,
        date: '2026-10-13',
        startMinute: 11 * 60,
        paymentMethod: 'sur_place',
        redeemReward: false,
        promoCode: null,
      }),
    ).rejects.toThrow(/inactif/);
  });

  it('confirme une promo à 100 % sans laisser le rendez-vous en attente de paiement', async () => {
    const data = createLocalRepository(memoryStore());
    await data.ready;
    await data.signIn('karim@lenanometre.ca', 'nanometre');
    await data.savePromo({
      code: 'LIBRE100',
      discountType: 'percent',
      value: 100,
      startsOn: '2026-10-01',
      endsOn: '2026-12-31',
      usageLimit: 5,
      usageCount: 0,
      active: true,
    });
    await data.signOut();
    await data.signIn('alex.gagnon@exemple.ca', 'nanometre');
    const service = (await data.getServices()).find((item) => item.name === 'Coupe classique');
    let slot: { startMinute: number } | undefined;
    let date = '';
    for (const candidate of ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']) {
      const slots = await data.getSlots({ barberId: JULIEN, serviceId: service!.id, date: candidate });
      slot = slots.find((item) => item.available);
      if (slot) {
        date = candidate;
        break;
      }
    }
    expect(slot).toBeTruthy();
    const booking = await data.createBooking({
      serviceId: service!.id,
      barberId: JULIEN,
      date,
      startMinute: slot!.startMinute,
      paymentMethod: 'en_ligne',
      redeemReward: false,
      promoCode: 'LIBRE100',
    });
    expect(booking.totalCents).toBe(0);
    expect(booking.status).toBe('confirme');
    expect(booking.paymentStatus).toBe('a_encaisser');
    await data.signOut();
    await data.signIn('karim@lenanometre.ca', 'nanometre');
    const promo = (await data.listPromos()).find((item) => item.code === 'LIBRE100');
    expect(promo?.usageCount).toBe(1);
  });

  it('borne les heures et ignore les rendez-vous passés, sans nom dans le message', async () => {
    const data = createLocalRepository(memoryStore());
    await data.ready;
    await data.signIn('karim@lenanometre.ca', 'nanometre');
    await expect(data.updateSalonSettings({ openMinute: -600, closeMinute: 5000, onsiteLatePolicy: 'aucun' })).rejects.toThrow(/Réglage invalide/);
    const ids = futureOutsideHours(
      [
        { id: 'passe', date: '2026-09-01', startMinute: 8 * 60, durationMinutes: 60, status: 'honore' },
        { id: 'avenir', date: '2026-10-20', startMinute: 8 * 60, durationMinutes: 60, status: 'confirme' },
      ],
      10 * 60,
      17 * 60,
      new Date('2026-10-07T12:00:00Z'),
    );
    expect(ids).toEqual(['avenir']);
    expect(hoursConflictMessage(ids)).not.toMatch(/Loïc|Alex|Bergeron/);
    expect(hoursConflictMessage(ids)).toContain('avenir');
    expect(futureOutsideHours(
      [{ id: 'passe', date: '2026-09-01', startMinute: 8 * 60, durationMinutes: 60, status: 'honore' }],
      10 * 60,
      17 * 60,
      new Date('2026-10-07T12:00:00Z'),
    )).toEqual([]);
  });
});
