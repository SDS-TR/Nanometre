import { describe, expect, it } from 'vitest';
import { weekdayOfIso, zonedDateTime, zonedParts } from './zonedTime';

describe('heure de Québec', () => {
  it('place le 6 octobre 2026 à 14 h 30 en HAE', () => {
    const instant = zonedDateTime('2026-10-06', 14 * 60 + 30);
    expect(instant.toISOString()).toBe('2026-10-06T18:30:00.000Z');
    expect(zonedParts(instant)).toMatchObject({
      isoDate: '2026-10-06',
      minuteOfDay: 14 * 60 + 30,
      weekday: 2,
    });
    expect(weekdayOfIso('2026-10-06')).toBe(2);
    expect(weekdayOfIso('2026-10-04')).toBe(0);
  });
});
