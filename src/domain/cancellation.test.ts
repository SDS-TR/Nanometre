import { describe, expect, it } from 'vitest';
import { extractIncludedTaxes, lateFeeCents, quoteCancellation } from './cancellation';
import { computeLineTaxes } from './taxes';

const examples: [number, number, number, number][] = [
  [2750, 131, 249, 2370],
  [2250, 107, 204, 1939],
  [2000, 95, 181, 1724],
  [1750, 83, 159, 1508],
  [1250, 60, 113, 1077],
  [2500, 119, 227, 2154],
];

describe('frais d’annulation tardive', () => {
  it('prend 50 % du prix avant taxes', () => {
    expect(lateFeeCents(5500)).toBe(2750);
    expect(lateFeeCents(4500)).toBe(2250);
    expect(lateFeeCents(4000)).toBe(2000);
    expect(lateFeeCents(3500)).toBe(1750);
    expect(lateFeeCents(2500)).toBe(1250);
  });

  it('extrait TPS et TVQ selon Revenu Québec', () => {
    for (const [fee, gst, qst, net] of examples) {
      expect(extractIncludedTaxes(fee)).toEqual({
        feeCents: fee,
        gstCents: gst,
        qstCents: qst,
        netCents: net,
      });
    }
  });

  it('rembourse le solde d’une coupe + barbe payée en ligne', () => {
    const taxes = computeLineTaxes(5500);
    const startsAt = new Date('2026-10-06T18:30:00.000Z');
    const quote = quoteCancellation({
      startsAt,
      now: new Date(startsAt.getTime() - 23 * 60 * 60 * 1000),
      preTaxCents: 5500,
      totalCents: taxes.totalCents,
      paymentMethod: 'en_ligne',
      paymentStatus: 'paye',
      status: 'confirme',
    });
    expect(quote.feeApplies).toBe(true);
    expect(quote.feeCents).toBe(2750);
    expect(quote.refundCents).toBe(3574);
    expect(quote.extraction).toMatchObject({ gstCents: 131, qstCents: 249, netCents: 2370 });
    expect(quote.receipt).toContain('27,50');
    expect(quote.receipt).toContain('1,31');
    expect(quote.receipt).toContain('2,49');
  });

  it('est gratuite à exactement 24 h et au-delà', () => {
    const startsAt = new Date('2026-10-06T18:30:00.000Z');
    const quote = quoteCancellation({
      startsAt,
      now: new Date(startsAt.getTime() - 24 * 60 * 60 * 1000),
      preTaxCents: 5500,
      totalCents: 6324,
      paymentMethod: 'en_ligne',
      paymentStatus: 'paye',
      status: 'confirme',
    });
    expect(quote.within24h).toBe(false);
    expect(quote.feeCents).toBe(0);
    expect(quote.refundCents).toBe(6324);
  });

  it('ne retient rien si le rendez-vous sur place n’a pas été encaissé', () => {
    const startsAt = new Date('2026-10-02T14:00:00.000Z');
    const quote = quoteCancellation({
      startsAt,
      now: new Date(startsAt.getTime() - 2 * 60 * 60 * 1000),
      preTaxCents: 5500,
      totalCents: 6324,
      paymentMethod: 'sur_place',
      paymentStatus: 'a_encaisser',
      status: 'confirme',
    });
    expect(quote.allowed).toBe(true);
    expect(quote.within24h).toBe(true);
    expect(quote.feeApplies).toBe(false);
    expect(quote.feeOwingCents).toBe(0);
    expect(quote.refundCents).toBe(0);
  });

  it('peut inscrire le frais tardif sur place comme dû à la prochaine visite', () => {
    const startsAt = new Date('2026-10-02T14:00:00.000Z');
    const quote = quoteCancellation({
      startsAt,
      now: new Date(startsAt.getTime() - 2 * 60 * 60 * 1000),
      preTaxCents: 5500,
      totalCents: 6324,
      paymentMethod: 'sur_place',
      paymentStatus: 'a_encaisser',
      status: 'confirme',
      onsiteLatePolicy: 'a_la_prochaine',
    });
    expect(quote.feeApplies).toBe(false);
    expect(quote.feeOwingCents).toBe(2750);
    expect(quote.refundCents).toBe(0);
    expect(quote.receipt).toContain('27,50');
    expect(quote.receipt).toContain('Ces numéros sont des espaces réservés');
  });

  it('inscrit les numéros du salon et retire l’avertissement quand ils sont réels', () => {
    const startsAt = new Date('2026-10-02T14:00:00.000Z');
    const quote = quoteCancellation({
      startsAt,
      now: new Date(startsAt.getTime() - 2 * 60 * 60 * 1000),
      preTaxCents: 5500,
      totalCents: 6324,
      paymentMethod: 'en_ligne',
      paymentStatus: 'paye',
      status: 'confirme',
      gstNumber: '123456789 RT0001',
      qstNumber: '1234567890 TQ0001',
      taxNumbersPlaceholder: true,
    });
    expect(quote.receipt).toContain('123456789 RT0001');
    expect(quote.receipt).toContain('1234567890 TQ0001');
    expect(quote.receipt).toContain('espaces réservés');
    const real = quoteCancellation({
      startsAt,
      now: new Date(startsAt.getTime() - 2 * 60 * 60 * 1000),
      preTaxCents: 5500,
      totalCents: 6324,
      paymentMethod: 'en_ligne',
      paymentStatus: 'paye',
      status: 'confirme',
      gstNumber: '999999999 RT0001',
      qstNumber: '9999999999 TQ0001',
      taxNumbersPlaceholder: false,
    });
    expect(real.receipt).toContain('999999999 RT0001');
    expect(real.receipt).not.toContain('espaces réservés');
  });

  it('refuse une annulation déjà passée ou déjà faite', () => {
    const startsAt = new Date('2026-10-01T14:00:00.000Z');
    expect(
      quoteCancellation({
        startsAt,
        now: startsAt,
        preTaxCents: 3500,
        totalCents: 4024,
        paymentMethod: 'en_ligne',
        paymentStatus: 'paye',
        status: 'confirme',
      }).reason,
    ).toBe('deja_passe');
    expect(
      quoteCancellation({
        startsAt,
        now: new Date(startsAt.getTime() - 48 * 60 * 60 * 1000),
        preTaxCents: 3500,
        totalCents: 4024,
        paymentMethod: 'en_ligne',
        paymentStatus: 'rembourse',
        status: 'annule',
      }).reason,
    ).toBe('deja_annule');
  });
});
