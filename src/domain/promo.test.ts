import { describe, expect, it } from 'vitest';
import { quotePromo, type PromoCode } from './promo';
import { computeLineTaxes } from './taxes';

const welcome: PromoCode = {
  code: 'BIENVENUE10',
  discountType: 'percent',
  value: 10,
  startsOn: '2026-07-01',
  endsOn: '2026-12-31',
  usageLimit: 100,
  usageCount: 95,
  active: true,
};

describe('codes promo', () => {
  it('réduit le hors taxes avant les taxes', () => {
    const quote = quotePromo(welcome, '2026-10-01', 5500);
    expect(quote).toEqual({ ok: true, code: 'BIENVENUE10', discountCents: 550 });
    if (quote.ok) {
      expect(computeLineTaxes(5500 - quote.discountCents).totalCents).toBe(5692);
    }
  });

  it('refuse un code expiré, épuisé ou inconnu', () => {
    expect(quotePromo({ ...welcome, endsOn: '2026-08-31' }, '2026-10-01', 5500).ok).toBe(false);
    expect(quotePromo({ ...welcome, usageCount: 100 }, '2026-10-01', 5500).ok).toBe(false);
    expect(quotePromo(undefined, '2026-10-01', 5500)).toMatchObject({ ok: false });
    const amount = quotePromo(
      { ...welcome, code: 'RENTREE5', discountType: 'amount', value: 500, startsOn: '2026-09-01', endsOn: '2026-09-30' },
      '2026-09-15',
      3500,
    );
    expect(amount).toMatchObject({ ok: true, discountCents: 500 });
  });
});
