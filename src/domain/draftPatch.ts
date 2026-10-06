export type PromoDraft = {
  serviceId?: string;
  barberId?: string | 'any';
  assignedBarberId?: string;
  date?: string;
  promoCode?: string | null;
  discountCents?: number;
};

/** Un changement de prestation, de coiffeur ou de date invalide la promo déjà citée. */
export function applyDraftPatch<T extends PromoDraft>(draft: T, patch: Partial<T>): T {
  const serviceChanged = patch.serviceId != null && patch.serviceId !== draft.serviceId;
  const dateChanged = patch.date != null && patch.date !== draft.date;
  const barberChanged =
    (patch.barberId != null && patch.barberId !== draft.barberId) ||
    (patch.assignedBarberId != null && patch.assignedBarberId !== draft.assignedBarberId);
  const next = { ...draft, ...patch };
  if (serviceChanged || dateChanged || barberChanged) {
    next.promoCode = null;
    next.discountCents = 0;
  }
  return next;
}
