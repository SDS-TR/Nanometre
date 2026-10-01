import { formatCad } from './format';
import { applyRatio } from './money';

export const CANCEL_FREE_HOURS = 24;
export const LATE_FEE_RATE_NUMERATOR = 1n;
export const LATE_FEE_RATE_DENOMINATOR = 2n;

export type TaxExtraction = {
  feeCents: number;
  gstCents: number;
  qstCents: number;
  netCents: number;
};

export type BookingLifecycle = 'en_attente_paiement' | 'confirme' | 'honore' | 'annule' | 'annule_tardif';
export type PaymentMethod = 'en_ligne' | 'sur_place';
export type PaymentStatus =
  | 'en_attente'
  | 'paye'
  | 'a_encaisser'
  | 'rembourse_partiel'
  | 'rembourse'
  | 'remboursement_en_cours'
  | 'echoue';

export type OnsiteLatePolicy = 'aucun' | 'a_la_prochaine';

export type CancelQuote = {
  allowed: boolean;
  reason?: 'deja_passe' | 'deja_annule';
  within24h: boolean;
  /** Frais retenus seulement si le rendez-vous en ligne est déjà payé. */
  feeApplies: boolean;
  feeCents: number;
  /** Montant dû à la prochaine visite, si la politique du salon le prévoit. Rien n'est prélevé maintenant. */
  feeOwingCents: number;
  refundCents: number;
  extraction: TaxExtraction | null;
  receipt: string | null;
};

/** 50 % du prix avant taxes, arrondi au cent. 55,00 $ → 27,50 $. */
export function lateFeeCents(preTaxCents: number): number {
  return applyRatio(preTaxCents, LATE_FEE_RATE_NUMERATOR, LATE_FEE_RATE_DENOMINATOR);
}

/**
 * Frais taxes incluses (LTA art. 182, LTVQ art. 318, méthode Revenu Québec).
 * TPS = round(round(frais × 100/105) × 5 %)
 * TVQ = round(round(frais × 100/109,975) × 9,975 %)
 * Part HT = frais − TPS − TVQ.
 * 27,50 $ → TPS 1,31 $, TVQ 2,49 $, HT 23,70 $.
 */
export function extractIncludedTaxes(feeCents: number): TaxExtraction {
  if (feeCents < 0) {
    throw new Error('Les frais ne peuvent pas être négatifs');
  }
  const gstBaseCents = applyRatio(feeCents, 100n, 105n);
  const gstCents = applyRatio(gstBaseCents, 5n, 100n);
  const qstBaseCents = applyRatio(feeCents, 100_000n, 109_975n);
  const qstCents = applyRatio(qstBaseCents, 9975n, 100_000n);
  return {
    feeCents,
    gstCents,
    qstCents,
    netCents: feeCents - gstCents - qstCents,
  };
}

export function cancellationReceipt(extraction: TaxExtraction, gstNumber: string, qstNumber: string): string {
  return `Frais d'annulation tardive ${formatCad(extraction.feeCents)} (TPS ${formatCad(extraction.gstCents)}, TVQ ${formatCad(extraction.qstCents)} incluses). TPS ${gstNumber}. TVQ ${qstNumber}.`;
}

const blocked = (reason: 'deja_passe' | 'deja_annule'): CancelQuote => ({
  allowed: false,
  reason,
  within24h: false,
  feeApplies: false,
  feeCents: 0,
  feeOwingCents: 0,
  refundCents: 0,
  extraction: null,
  receipt: null,
});

export function quoteCancellation(input: {
  startsAt: Date;
  now: Date;
  preTaxCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: BookingLifecycle;
  gstNumber?: string;
  qstNumber?: string;
  /** Défaut : aucun frais sur une annulation tardive payée sur place. */
  onsiteLatePolicy?: OnsiteLatePolicy;
}): CancelQuote {
  if (input.status === 'annule' || input.status === 'annule_tardif') {
    return blocked('deja_annule');
  }
  if (input.status === 'honore' || input.startsAt.getTime() <= input.now.getTime()) {
    return blocked('deja_passe');
  }

  const within24h = input.startsAt.getTime() - input.now.getTime() < CANCEL_FREE_HOURS * 60 * 60 * 1000;
  const paidOnline = input.paymentMethod === 'en_ligne' && input.paymentStatus === 'paye';

  const owing =
    within24h &&
    !paidOnline &&
    input.paymentMethod === 'sur_place' &&
    input.onsiteLatePolicy === 'a_la_prochaine';

  if (!within24h || !paidOnline) {
    const feeOwingCents = owing ? lateFeeCents(input.preTaxCents) : 0;
    return {
      allowed: true,
      within24h,
      feeApplies: false,
      feeCents: 0,
      feeOwingCents,
      refundCents: !within24h && paidOnline ? input.totalCents : 0,
      extraction: owing ? extractIncludedTaxes(feeOwingCents) : null,
      receipt: owing
        ? `Montant dû à la prochaine visite : ${cancellationReceipt(extractIncludedTaxes(feeOwingCents), input.gstNumber ?? '123456789 RT0001', input.qstNumber ?? '1234567890 TQ0001')}`
        : null,
    };
  }

  const feeCents = lateFeeCents(input.preTaxCents);
  const extraction = extractIncludedTaxes(feeCents);
  return {
    allowed: true,
    within24h: true,
    feeApplies: true,
    feeCents,
    feeOwingCents: 0,
    refundCents: input.totalCents - feeCents,
    extraction,
    receipt: cancellationReceipt(
      extraction,
      input.gstNumber ?? '123456789 RT0001',
      input.qstNumber ?? '1234567890 TQ0001',
    ),
  };
}
