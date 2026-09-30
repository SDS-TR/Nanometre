import { describe, expect, it } from 'vitest';
import { applyHonoredVisit, cutsUntilReward, emptyLoyalty, pointsForPreTaxCents, restoreReward } from './loyalty';

describe('fidélité', () => {
  it('donne 1 point par dollar avant taxes', () => {
    expect(pointsForPreTaxCents(5500)).toBe(55);
    expect(pointsForPreTaxCents(4099)).toBe(40);
  });

  it('offre une coupe au bout de 10 et remet les tampons à zéro', () => {
    let state = emptyLoyalty();
    for (let visit = 0; visit < 9; visit += 1) {
      state = applyHonoredVisit(state, 3500, false);
    }
    expect(state).toEqual({ points: 315, stamps: 9, rewardsAvailable: 0 });
    expect(cutsUntilReward(state.stamps)).toBe(1);
    state = applyHonoredVisit(state, 3500, false);
    expect(state).toEqual({ points: 350, stamps: 0, rewardsAvailable: 1 });
  });

  it('consomme la coupe offerte sans ajouter de point, et la rend si on annule', () => {
    const ready = { points: 280, stamps: 7, rewardsAvailable: 1 };
    const used = applyHonoredVisit(ready, 0, true);
    expect(used).toEqual({ points: 280, stamps: 7, rewardsAvailable: 0 });
    expect(restoreReward(used).rewardsAvailable).toBe(1);
  });
});
