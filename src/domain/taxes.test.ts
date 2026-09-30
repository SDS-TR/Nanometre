import { describe, expect, it } from 'vitest';
import { computeLineTaxes } from './taxes';

describe('taxes de vente par ligne', () => {
  it('calcule la coupe + barbe : 55,00 + 2,75 + 5,49 = 63,24', () => {
    expect(computeLineTaxes(5500)).toEqual({
      subtotalCents: 5500,
      gstCents: 275,
      qstCents: 549,
      totalCents: 6324,
    });
  });

  it('couvre le tarif de chaque prestation', () => {
    expect(computeLineTaxes(3500).totalCents).toBe(4024);
    expect(computeLineTaxes(4000)).toMatchObject({ gstCents: 200, qstCents: 399, totalCents: 4599 });
    expect(computeLineTaxes(2500)).toMatchObject({ gstCents: 125, qstCents: 249, totalCents: 2874 });
    expect(computeLineTaxes(4500)).toMatchObject({ gstCents: 225, qstCents: 449, totalCents: 5174 });
    expect(computeLineTaxes(0)).toEqual({
      subtotalCents: 0,
      gstCents: 0,
      qstCents: 0,
      totalCents: 0,
    });
  });
});
