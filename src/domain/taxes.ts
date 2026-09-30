import { applyRatio } from './money';

/** TPS 5 % et TVQ 9,975 %, chacune sur le sous-total, arrondie au cent. */
export const GST_NUMERATOR = 5n;
export const GST_DENOMINATOR = 100n;
export const QST_NUMERATOR = 9975n;
export const QST_DENOMINATOR = 100_000n;

export type LineTax = {
  subtotalCents: number;
  gstCents: number;
  qstCents: number;
  totalCents: number;
};

/**
 * Taxes de vente par ligne.
 * Exemple validé : 55,00 $ → TPS 2,75 $ + TVQ 5,49 $ = 63,24 $.
 */
export function computeLineTaxes(subtotalCents: number): LineTax {
  if (subtotalCents < 0) {
    throw new Error('Le sous-total ne peut pas être négatif');
  }
  const gstCents = applyRatio(subtotalCents, GST_NUMERATOR, GST_DENOMINATOR);
  const qstCents = applyRatio(subtotalCents, QST_NUMERATOR, QST_DENOMINATOR);
  return {
    subtotalCents,
    gstCents,
    qstCents,
    totalCents: subtotalCents + gstCents + qstCents,
  };
}
