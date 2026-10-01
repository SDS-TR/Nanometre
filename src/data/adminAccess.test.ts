import { describe, expect, it } from 'vitest';
import { createLocalRepository } from './localRepository';
import { memoryStore } from './storage';

const JULIEN = '20000000-0000-4000-8000-000000000002';
const KARIM = '20000000-0000-4000-8000-000000000001';

async function repo() {
  const created = createLocalRepository(memoryStore());
  await created.ready;
  return created;
}

describe('droits équipe', () => {
  it('refuse le tableau et les paiements à un coiffeur', async () => {
    const data = await repo();
    await data.signIn('julien.morel@lenanometre.ca', 'nanometre');
    await expect(data.getDashboard({ anchor: '2026-10-03', period: 'jour' })).rejects.toThrow('Accès refusé');
    await expect(data.listPayments({ from: '2026-10-01', to: '2026-10-31' })).rejects.toThrow('Accès refusé');
    await expect(data.getAgenda({ date: '2026-10-06', barberId: KARIM })).rejects.toThrow('Accès refusé');
    const day = await data.getDay('2026-10-03');
    expect(day.revenueHtCents).toBeNull();
    const own = await data.getAgenda({ date: '2026-10-06' });
    expect(own.every((entry) => entry.barberId === JULIEN)).toBe(true);
    expect(own.every((entry) => entry.priceLabel == null)).toBe(true);
    const clients = await data.listClients();
    expect(clients.length).toBeGreaterThan(0);
    expect(clients.every((client) => client.points == null && client.spentHtCents == null)).toBe(true);
    expect(clients.every((client) => client.history.every((row) => row.priceLabel == null))).toBe(true);
  });

  it('laisse le propriétaire voir les montants et protège le dernier propriétaire', async () => {
    const data = await repo();
    await data.signIn('karim@lenanometre.ca', 'nanometre');
    const board = await data.getDashboard({ anchor: '2026-10-03', period: 'jour' });
    expect(board.revenueHtCents).not.toBeNull();
    const karim = (await data.listTeam()).find((member) => member.email === 'karim@lenanometre.ca');
    await expect(data.setMemberActive(karim!.id, false)).rejects.toThrow('Il doit rester au moins un propriétaire actif.');
    await expect(data.setMemberRole(karim!.id, 'coiffeur')).rejects.toThrow('Il doit rester au moins un propriétaire actif.');
  });

  it('valide un code promo avant les taxes et refuse un code épuisé', async () => {
    const data = await repo();
    await data.signIn('alex.gagnon@exemple.ca', 'nanometre');
    const quote = await data.validatePromo({ code: 'bienvenue10', date: '2026-10-06', subtotalCents: 5500 });
    expect(quote).toEqual({ ok: true, code: 'BIENVENUE10', discountCents: 550 });
    await expect(data.validatePromo({ code: 'ETE20', date: '2026-10-06', subtotalCents: 5500 })).rejects.toThrow(/limite|date/);
  });

  it('crédite la fidélité seulement quand la visite est honorée', async () => {
    const data = await repo();
    await data.signIn('alex.gagnon@exemple.ca', 'nanometre');
    const before = await data.getLoyalty();
    const booking = (await data.getMyBookings()).find((item) => item.status === 'confirme');
    expect(booking).toBeTruthy();
    await data.signOut();
    await data.signIn('karim@lenanometre.ca', 'nanometre');
    let moved = false;
    for (const start of [540, 600, 660, 720, 780]) {
      try {
        await data.moveBooking({ bookingId: booking!.id, date: '2026-09-15', startMinute: start });
        moved = true;
        break;
      } catch {
        moved = false;
      }
    }
    expect(moved).toBe(true);
    await data.honorBooking(booking!.id);
    await data.signOut();
    await data.signIn('alex.gagnon@exemple.ca', 'nanometre');
    const after = await data.getLoyalty();
    expect(after.points).toBeGreaterThan(before.points);
    expect(after.stamps).toBe((before.stamps + 1) % 10);
  });

  it('n’écrit une notification que si la personne a accepté', async () => {
    const data = await repo();
    await data.signIn('julien.morel@lenanometre.ca', 'nanometre');
    expect(await data.listMyNotifications()).toEqual([]);
    await data.signOut();
    await data.signIn('alex.gagnon@exemple.ca', 'nanometre');
    const service = (await data.getServices()).find((item) => item.slug === 'coupe-classique');
    const slots = await data.getSlots({ barberId: JULIEN, serviceId: service!.id, date: '2026-11-10' });
    const freeSlots = slots.filter((slot) => slot.available);
    const gap = service!.durationMinutes;
    const free = freeSlots[0];
    const later = freeSlots.find((slot) => slot.startMinute >= free.startMinute + gap);
    const third = freeSlots.find((slot) => later && slot.startMinute >= later.startMinute + gap);
    expect(third).toBeTruthy();
    await data.createBooking({
      serviceId: service!.id,
      barberId: JULIEN,
      date: '2026-11-10',
      startMinute: free.startMinute,
      paymentMethod: 'sur_place',
      redeemReward: false,
      promoCode: 'BIENVENUE10',
    });
    expect(await data.listMyNotifications()).toEqual([]);
    await data.setNotificationOptIn(true);
    await data.createBooking({
      serviceId: service!.id,
      barberId: JULIEN,
      date: '2026-11-10',
      startMinute: later!.startMinute,
      paymentMethod: 'sur_place',
      redeemReward: false,
    });
    const mine = await data.listMyNotifications();
    expect(mine.map((item) => item.kind)).toContain('confirmation');
    expect(mine.map((item) => item.kind)).toContain('rappel_24h');
    expect(mine.map((item) => item.kind)).toContain('rappel_2h');
    expect(mine[0]?.path).toContain('/rendez-vous?booking=');
    await data.signOut();
    await data.signIn('julien.morel@lenanometre.ca', 'nanometre');
    expect(await data.listMyNotifications()).toEqual([]);
    await data.setNotificationOptIn(true);
    await data.signOut();
    await data.signIn('alex.gagnon@exemple.ca', 'nanometre');
    await data.createBooking({
      serviceId: service!.id,
      barberId: JULIEN,
      date: '2026-11-10',
      startMinute: third!.startMinute,
      paymentMethod: 'sur_place',
      redeemReward: false,
    });
    await data.signOut();
    await data.signIn('julien.morel@lenanometre.ca', 'nanometre');
    const barberNotes = await data.listMyNotifications();
    expect(barberNotes.some((item) => item.title === 'Nouveau rendez-vous')).toBe(true);
  });
});
