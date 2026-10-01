import { applyRatio } from './money';

export type PromoCode = {
  code: string;
  discountType: 'percent' | 'amount';
  /** Pourcentage entier, ou montant en cents. */
  value: number;
  startsOn: string;
  endsOn: string;
  usageLimit: number | null;
  usageCount: number;
  active: boolean;
};

export type PromoQuote =
  | { ok: true; code: string; discountCents: number }
  | { ok: false; reason: string };

export function quotePromo(promo: PromoCode | undefined, onDate: string, subtotalCents: number): PromoQuote {
  if (!promo || !promo.active) {
    return { ok: false, reason: 'Ce code n’est pas reconnu.' };
  }
  if (onDate < promo.startsOn || onDate > promo.endsOn) {
    return { ok: false, reason: 'Ce code n’est pas valable à cette date.' };
  }
  if (promo.usageLimit != null && promo.usageCount >= promo.usageLimit) {
    return { ok: false, reason: 'Ce code a atteint sa limite.' };
  }
  if (subtotalCents <= 0) {
    return { ok: false, reason: 'Rien à réduire sur cette coupe.' };
  }
  const discountCents =
    promo.discountType === 'percent'
      ? applyRatio(subtotalCents, BigInt(promo.value), 100n)
      : Math.min(promo.value, subtotalCents);
  if (discountCents <= 0) {
    return { ok: false, reason: 'Ce code ne change pas le montant.' };
  }
  return { ok: true, code: promo.code, discountCents };
}
