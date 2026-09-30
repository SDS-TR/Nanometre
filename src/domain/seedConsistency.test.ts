import { describe, expect, it } from 'vitest';
import seed from '../data/seed.normalized.json';
import { extractIncludedTaxes } from './cancellation';
import { freeSlots, generateSlots } from './slots';
import { computeLineTaxes } from './taxes';
import { weekdayOfIso } from './zonedTime';

const JULIEN = '20000000-0000-4000-8000-000000000002';

describe('seed admin_data', () => {
  it('aligne chaque rendez-vous sur le calcul de taxes', () => {
    expect(seed.bookings.length).toBeGreaterThan(100);
    for (const booking of seed.bookings) {
      const taxes = computeLineTaxes(booking.priceCents);
      expect(taxes.gstCents).toBe(booking.gstCents);
      expect(taxes.qstCents).toBe(booking.qstCents);
      expect(taxes.totalCents).toBe(booking.totalCents);
      if (booking.feeCents > 0) {
        expect(extractIncludedTaxes(booking.feeCents)).toMatchObject({
          gstCents: booking.feeGstCents,
          qstCents: booking.feeQstCents,
          netCents: booking.feeHtCents,
        });
      }
    }
  });

  it('garde le 6 octobre de Julien, avec la réservation d’Alex à 14 h 30', () => {
    const alex = seed.bookings.find(
      (booking) =>
        booking.date === '2026-10-06' &&
        booking.clientName === 'Alex Gagnon' &&
        booking.barberId === JULIEN,
    );
    expect(alex).toMatchObject({ startMinute: 14 * 60 + 30, priceCents: 5500, totalCents: 6324, status: 'confirme' });
    const busy = seed.bookings
      .filter(
        (booking) =>
          booking.date === '2026-10-06' &&
          booking.barberId === JULIEN &&
          booking.status === 'confirme' &&
          booking.id !== alex?.id,
      )
      .map((booking) => ({ start: booking.startMinute, end: booking.startMinute + booking.durationMinutes }));
    expect(freeSlots(generateSlots({ weekday: weekdayOfIso('2026-10-06'), durationMinutes: 60, busy })).map((slot) => slot.startMinute)).toEqual([
      14 * 60 + 15,
      14 * 60 + 30,
      14 * 60 + 45,
      15 * 60,
    ]);
  });
});
