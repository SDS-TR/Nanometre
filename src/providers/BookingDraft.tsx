import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PaymentMethod } from '../domain';

export type Draft = {
  serviceId?: string;
  barberId?: string | 'any';
  assignedBarberId?: string;
  date?: string;
  startMinute?: number;
  endMinute?: number;
  paymentMethod: PaymentMethod;
  redeem: boolean;
  bookingId?: string;
  promoCode?: string | null;
  discountCents?: number;
};

type DraftContext = {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  reset: () => void;
};

const Context = createContext<DraftContext | null>(null);

const initial: Draft = { paymentMethod: 'en_ligne', redeem: false };

export function BookingDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      const same = (Object.keys(patch) as (keyof Draft)[]).every((key) => current[key] === next[key]);
      return same ? current : next;
    });
  }, []);
  const reset = useCallback(() => setDraft(initial), []);
  const value = useMemo<DraftContext>(() => ({ draft, update, reset }), [draft, update, reset]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDraft(): DraftContext {
  const value = useContext(Context);
  if (!value) {
    throw new Error('useDraft doit être utilisé dans le parcours de réservation');
  }
  return value;
}
