export const CHECKOUT_HOLD_MS = 15 * 60 * 1000;

export function holdExpired(createdAt: string | undefined, now: Date, holdMs = CHECKOUT_HOLD_MS): boolean {
  if (!createdAt) {
    return false;
  }
  return now.getTime() - new Date(createdAt).getTime() >= holdMs;
}
