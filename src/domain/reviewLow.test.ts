import { describe, expect, it } from 'vitest';
import { createLocalRepository } from '../data/localRepository';
import { memoryStore } from '../data/storage';
import { readableAudit } from './format';

const THOMAS = 'f4074385-3194-5838-b949-59b1014d8e70';

describe('revue faible', () => {
  it('rend le journal lisible, sans identifiant', () => {
    expect(readableAudit('invitation', 'invitation · Léa · coiffeur · 20000000-0000-4000-8000-000000000002')).not.toMatch(/[0-9a-f]{8}-/);
  });

  it('annule un rendez-vous sans compte client', async () => {
    const data = createLocalRepository(memoryStore());
    await data.ready;
    await data.signIn('karim@lenanometre.ca', 'nanometre');
    await data.moveBooking({
      bookingId: THOMAS,
      date: '2026-10-07',
      startMinute: 10 * 60,
      now: new Date('2026-10-01T15:00:00Z'),
    });
    await data.cancelClientBooking(THOMAS);
    const still = (await data.getAgenda({ date: '2026-10-07' })).find((entry) => entry.id === THOMAS);
    expect(still).toBeUndefined();
  });
});
