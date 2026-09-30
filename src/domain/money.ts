/**
 * Montants en cents entiers.
 * Arrondi demi supérieur (half away from zero), comme `round(numeric)` de PostgreSQL.
 */

export function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error('Dénominateur invalide');
  }
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}

/** Applique une fraction num/den à un montant en cents, arrondi au cent. */
export function applyRatio(cents: number, numerator: bigint, denominator: bigint): number {
  if (!Number.isInteger(cents)) {
    throw new Error('Le montant doit être un nombre entier de cents');
  }
  return Number(roundHalfUpDiv(BigInt(cents) * numerator, denominator));
}
