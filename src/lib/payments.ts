export const STRIPE_API_VERSION = '2025-08-27.basil';

export function paymentIntentIdempotencyKey(bookingId: string, totalCents: number): string {
  return `pi-${bookingId}-${totalCents}`;
}

export function refundIdempotencyKey(bookingId: string, kind: 'cancel' | 'fee' | 'delete' | 'abandon' | 'orphan' | 'expire'): string {
  return `refund-${bookingId}-${kind}`;
}

export function paymentIsConsistent(input: {
  storedIntentId: string | null;
  intentId: string;
  amountReceived: number;
  expectedCents: number;
  currency: string;
}): boolean {
  return (
    input.storedIntentId === input.intentId &&
    input.amountReceived === input.expectedCents &&
    input.currency.toLowerCase() === 'cad'
  );
}

export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  return typeof secret === 'string' && secret.length >= 16 && authorization === `Bearer ${secret}`;
}
