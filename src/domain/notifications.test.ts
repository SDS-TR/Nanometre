import { describe, expect, it } from 'vitest';
import { planBookingNotifications, planChangeNotification } from './notifications';

describe('planification des notifications', () => {
  const startsAt = new Date('2026-10-06T13:00:00.000Z');
  const createdAt = new Date('2026-10-01T15:00:00.000Z');

  it('prévoit la confirmation, le rappel 24 h et le rappel 2 h', () => {
    const drafts = planBookingNotifications({
      bookingId: 'b1',
      startsAt,
      createdAt,
      summary: 'Coupe + barbe avec Julien, mardi 6 octobre à 9 h 00.',
    });
    const client = drafts.filter((draft) => draft.recipient === 'client').map((draft) => draft.kind);
    expect(client).toEqual(['confirmation', 'rappel_24h', 'rappel_2h']);
    expect(drafts.find((draft) => draft.kind === 'rappel_24h')?.sendAt.toISOString()).toBe('2026-10-05T13:00:00.000Z');
    expect(drafts.find((draft) => draft.kind === 'rappel_2h')?.sendAt.toISOString()).toBe('2026-10-06T11:00:00.000Z');
    expect(drafts[0].path).toBe('/rendez-vous?booking=b1');
    expect(drafts.some((draft) => draft.recipient === 'coiffeur' && draft.kind === 'confirmation')).toBe(true);
  });

  it('omet un rappel déjà passé', () => {
    const late = new Date(startsAt.getTime() - 30 * 60 * 1000);
    const kinds = planBookingNotifications({
      bookingId: 'b1',
      startsAt,
      createdAt: late,
      summary: 'Bientôt.',
    })
      .filter((draft) => draft.recipient === 'client')
      .map((draft) => draft.kind);
    expect(kinds).toEqual(['confirmation']);
  });

  it('prévient le client et le coiffeur si le rendez-vous change', () => {
    const drafts = planChangeNotification({
      bookingId: 'b1',
      at: createdAt,
      summary: 'Déplacé au mardi 6 octobre, 11 h 00.',
      kind: 'changement',
    });
    expect(drafts.map((draft) => draft.recipient).sort()).toEqual(['client', 'coiffeur']);
    expect(drafts.every((draft) => draft.path.includes('b1'))).toBe(true);
  });
});
