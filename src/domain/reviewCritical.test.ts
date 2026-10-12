import { defaultSalonWeek } from './salonWeek';
import { describe, expect, it } from 'vitest';
import { createLocalRepository } from '../data/localRepository';
import { memoryStore } from '../data/storage';
import { adminShell, staffTabRole } from './adminShell';
import { applyDraftPatch } from './draftPatch';
import { computeLineTaxes } from './taxes';
import { quotePromo, type PromoCode } from './promo';
import { assertMovableSlot } from './moveSlot';

const welcome: PromoCode = {
  code: 'BIENVENUE10',
  discountType: 'percent',
  value: 10,
  startsOn: '2026-07-01',
  endsOn: '2026-12-31',
  usageLimit: 100,
  usageCount: 0,
  active: true,
};

const THOMAS = 'f4074385-3194-5838-b949-59b1014d8e70';

describe('revue critique', () => {
  it('n’ouvre pas les onglets du propriétaire à un client', () => {
    expect(adminShell('client')).toBe('refuse');
    expect(staffTabRole('client')).toBeNull();
    expect(adminShell('proprietaire')).toBe('tabs');
    expect(staffTabRole('coiffeur')).toBe('coiffeur');
  });

  it('oublie la promo quand la prestation change, pour ne pas afficher 22,43 $ et prélever 25,87 $', () => {
    const stale = applyDraftPatch(
      { serviceId: 'coupe-barbe', promoCode: 'BIENVENUE10', discountCents: 550, date: '2026-10-07', startMinute: 600 },
      { serviceId: 'taille-barbe', startMinute: undefined },
    );
    expect(stale.promoCode).toBeNull();
    expect(stale.discountCents).toBe(0);
    const fresh = quotePromo(welcome, '2026-10-07', 2500);
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) {
      return;
    }
    const paid = computeLineTaxes(2500 - fresh.discountCents).totalCents;
    const shownIfStale = computeLineTaxes(Math.max(0, 2500 - 550)).totalCents;
    expect(paid).toBe(2587);
    expect(shownIfStale).toBe(2243);
    expect(paid).not.toBe(shownIfStale);
    const sameService = applyDraftPatch({ serviceId: 'taille-barbe', promoCode: 'BIENVENUE10', discountCents: fresh.discountCents }, { promoCode: 'BIENVENUE10', discountCents: fresh.discountCents });
    expect(sameService.discountCents).toBe(fresh.discountCents);
  });

  it('refuse une heure illisible, un jour fermé ou un créneau passé, sans rien déplacer', async () => {
    expect(() =>
      assertMovableSlot({
        date: 'demain',
        startMinute: Number.NaN,
        durationMinutes: 60,
        openMinute: 540,
        closeMinute: 1140,
        openWeekdays: [2, 3, 4, 5, 6],
        eligible: true,
        busy: [],
        blocked: [],
        now: new Date('2026-10-06T15:00:00Z'),
      }),
    ).toThrow('Date invalide.');
    expect(() =>
      assertMovableSlot({
        date: '2026-10-12',
        startMinute: 720,
        durationMinutes: 60,
        openMinute: 540,
        closeMinute: 1140,
        openWeekdays: [2, 3, 4, 5, 6],
        salonOpen: false,
        eligible: true,
        busy: [],
        blocked: [],
        now: new Date('2026-10-06T15:00:00Z'),
      }),
    ).toThrow('fermé');

    const data = createLocalRepository(memoryStore(), { now: () => new Date('2026-10-06T12:00:00Z') });
    await data.ready;
    await data.signIn('karim@lenanometre.ca', 'nanometre');
    const before = (await data.getAgenda({ date: '2026-10-06' })).find((entry) => entry.id === THOMAS);
    expect(before?.title).toBe('Thomas Moreau');
    await expect(data.moveBooking({ bookingId: THOMAS, date: 'demain', startMinute: Number.NaN })).rejects.toThrow('Date invalide.');
    await expect(data.moveBooking({ bookingId: THOMAS, date: '2026-10-07', startMinute: Number.NaN })).rejects.toThrow('Heure invalide.');
    // Le lundi est ouvert par défaut ; le propriétaire le ferme dans Horaires.
    await data.setSalonHours({ week: defaultSalonWeek().map((day) => (day.weekday === 1 ? { ...day, open: false } : day)) });
    await expect(data.moveBooking({ bookingId: THOMAS, date: '2026-10-19', startMinute: 15 * 60 })).rejects.toThrow('fermé');
    const still = (await data.getAgenda({ date: '2026-10-06' })).find((entry) => entry.id === THOMAS);
    expect(still?.startMinute).toBe(540);
    const gone = (await data.getAgenda({ date: '2026-10-07' })).find((entry) => entry.id === THOMAS);
    expect(gone).toBeUndefined();
  });
});
