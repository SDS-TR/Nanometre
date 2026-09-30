export const CUTS_PER_REWARD = 10;
export const POINTS_PER_DOLLAR = 1;

export type LoyaltyState = {
  points: number;
  /** Coupes depuis la dernière récompense, de 0 à 9. */
  stamps: number;
  rewardsAvailable: number;
};

export function emptyLoyalty(): LoyaltyState {
  return { points: 0, stamps: 0, rewardsAvailable: 0 };
}

/** 1 point par dollar avant taxes, partie entière. */
export function pointsForPreTaxCents(preTaxCents: number): number {
  if (preTaxCents < 0) {
    throw new Error('Montant invalide');
  }
  return Math.floor(preTaxCents / 100) * POINTS_PER_DOLLAR;
}

export function cutsUntilReward(stamps: number): number {
  return stamps === 0 ? CUTS_PER_REWARD : CUTS_PER_REWARD - stamps;
}

/**
 * Une visite honorée ajoute les points et avance la carte.
 * Une coupe offerte consommée n'ajoute ni point ni tampon.
 */
export function applyHonoredVisit(state: LoyaltyState, preTaxCents: number, redeemed: boolean): LoyaltyState {
  if (redeemed) {
    if (state.rewardsAvailable < 1) {
      throw new Error('Aucune coupe offerte à utiliser');
    }
    return {
      points: state.points,
      stamps: state.stamps,
      rewardsAvailable: state.rewardsAvailable - 1,
    };
  }
  const points = state.points + pointsForPreTaxCents(preTaxCents);
  const stamps = state.stamps + 1;
  if (stamps >= CUTS_PER_REWARD) {
    return {
      points,
      stamps: stamps % CUTS_PER_REWARD,
      rewardsAvailable: state.rewardsAvailable + Math.floor(stamps / CUTS_PER_REWARD),
    };
  }
  return { points, stamps, rewardsAvailable: state.rewardsAvailable };
}

export function restoreReward(state: LoyaltyState): LoyaltyState {
  return { ...state, rewardsAvailable: state.rewardsAvailable + 1 };
}
