import type { PromoCode } from './promo';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Refuse un champ vide, « abc » ou 0 $. Le prix affiché ne sert pas de valeur. */
export function parsePriceCents(raw: string): number {
  const trimmed = raw.trim();
  if (!/^\d+([.,]\d{1,2})?$/.test(trimmed)) {
    throw new Error('Tarif invalide.');
  }
  const cents = Math.round(Number(trimmed.replace(',', '.')) * 100);
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error('Tarif invalide.');
  }
  return cents;
}

export function priceDropNeedsConfirm(currentCents: number, nextCents: number): boolean {
  return nextCents * 2 < currentCents;
}

export function assertPromoDraft(promo: PromoCode): void {
  if (!/^[A-Z0-9]{3,24}$/.test(promo.code)) {
    throw new Error('Code invalide.');
  }
  if (promo.discountType === 'percent') {
    if (!Number.isInteger(promo.value) || promo.value < 1 || promo.value > 100) {
      throw new Error('Le pourcentage doit être entre 1 et 100.');
    }
  } else if (!Number.isInteger(promo.value) || promo.value <= 0) {
    throw new Error('Le montant doit être supérieur à 0.');
  }
  if (!ISO_DATE.test(promo.startsOn) || !ISO_DATE.test(promo.endsOn) || Number.isNaN(Date.parse(`${promo.startsOn}T12:00:00Z`))) {
    throw new Error('Dates invalides.');
  }
  if (promo.endsOn < promo.startsOn) {
    throw new Error('La fin doit suivre le début.');
  }
  if (promo.usageLimit != null && (!Number.isInteger(promo.usageLimit) || promo.usageLimit < 1)) {
    throw new Error('Limite invalide.');
  }
}

/** Une mise à jour ne remet pas le compteur à zéro. */
export function mergePromo(existing: PromoCode | undefined, next: PromoCode): PromoCode {
  assertPromoDraft(next);
  if (!existing) {
    return { ...next, usageCount: 0 };
  }
  return { ...next, usageCount: existing.usageCount };
}
