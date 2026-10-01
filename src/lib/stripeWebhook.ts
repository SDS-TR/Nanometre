import { orphanRefundCents, refundIdempotencyKey, stripeAlreadyRefunded } from './payments';

export type WebhookObject = Record<string, unknown>;

export type WebhookEvent = {
  id: string;
  type: string;
  data: { object: WebhookObject };
};

export type WebhookResult = { status: number; body: Record<string, unknown> };

export type WebhookDeps = {
  claimEvent: (id: string) => Promise<boolean>;
  getBooking: (id: string) => Promise<{ id: string; status: string } | null>;
  getPayment: (bookingId: string) => Promise<{ feeCents: number; stripeRefundCents: number } | null>;
  confirmPayment: (input: { bookingId: string; intentId: string; amount: number; currency: string }) => Promise<string | null>;
  syncRefund: (intentId: string, refunded: number) => Promise<string | null>;
  audit: (action: string, entity: string, entityId: string, detail: Record<string, unknown>) => Promise<void>;
  markFailed: (intentId: string) => Promise<void>;
  refund: (input: { paymentIntent: string; amount: number; bookingId: string; idempotencyKey: string }) => Promise<void>;
  retrieveCharge: (chargeId: string) => Promise<{ amountRefunded: number; paymentIntentId: string | null }>;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function intentIdOf(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && 'id' in value) {
    return asString((value as { id?: unknown }).id);
  }
  return null;
}

function metadataBookingId(object: WebhookObject): string | null {
  const metadata = object.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  return asString((metadata as { bookingId?: unknown }).bookingId);
}

const ignoredConfirm = (message: string) => message.includes('Paiement incohérent') || message.includes('État invalide');

async function onSucceeded(object: WebhookObject, deps: WebhookDeps): Promise<WebhookResult> {
  const bookingId = metadataBookingId(object);
  const intentId = asString(object.id);
  const amount = asNumber(object.amount_received);
  const currency = asString(object.currency);
  if (!bookingId || !intentId || amount == null || !currency) {
    return { status: 400, body: { error: 'Rendez-vous manquant' } };
  }
  const booking = await deps.getBooking(bookingId);
  if (!booking || booking.status === 'annule' || booking.status === 'annule_tardif') {
    const payment = await deps.getPayment(bookingId);
    const refundAmount = orphanRefundCents({
      amountReceived: amount,
      feeCents: payment?.feeCents ?? 0,
      stripeRefundCents: payment?.stripeRefundCents ?? 0,
    });
    if (refundAmount > 0) {
      await deps.refund({
        paymentIntent: intentId,
        amount: refundAmount,
        bookingId,
        idempotencyKey: refundIdempotencyKey(bookingId, 'orphan'),
      });
    }
    await deps.audit('remboursement_orphelin', 'booking', bookingId, {
      intentId,
      amount,
      refundAmount,
      currency,
      feeCents: payment?.feeCents ?? 0,
    });
    return { status: 200, body: { received: true, refunded: refundAmount > 0 } };
  }
  const error = await deps.confirmPayment({ bookingId, intentId, amount, currency });
  if (error) {
    if (ignoredConfirm(error)) {
      await deps.audit('paiement_incoherent', 'booking', bookingId, { intentId, amount, currency, error });
      return { status: 200, body: { received: true, ignored: true } };
    }
    return { status: 500, body: { error } };
  }
  return { status: 200, body: { received: true } };
}

async function onRefundUpdated(object: WebhookObject, deps: WebhookDeps): Promise<WebhookResult> {
  if (asString(object.status) !== 'succeeded') {
    return { status: 200, body: { received: true, ignored: true } };
  }
  const chargeId = asString(object.charge) ?? intentIdOf(object.charge);
  if (!chargeId) {
    return { status: 200, body: { received: true } };
  }
  const charge = await deps.retrieveCharge(chargeId);
  if (!charge.paymentIntentId) {
    return { status: 200, body: { received: true } };
  }
  const error = await deps.syncRefund(charge.paymentIntentId, charge.amountRefunded);
  if (error) {
    return { status: 500, body: { error } };
  }
  return { status: 200, body: { received: true } };
}

export async function handleStripeEvent(event: WebhookEvent, deps: WebhookDeps): Promise<WebhookResult> {
  const claimed = await deps.claimEvent(event.id);
  if (!claimed) {
    return { status: 200, body: { received: true, duplicate: true } };
  }
  try {
    const object = event.data.object;
    if (event.type === 'payment_intent.succeeded') {
      return await onSucceeded(object, deps);
    }
    if (event.type === 'payment_intent.payment_failed') {
      const intentId = asString(object.id);
      if (intentId) {
        await deps.markFailed(intentId);
      }
      return { status: 200, body: { received: true } };
    }
    if (event.type === 'charge.refunded') {
      const intentId = intentIdOf(object.payment_intent);
      const refunded = asNumber(object.amount_refunded);
      if (intentId && refunded != null) {
        const error = await deps.syncRefund(intentId, refunded);
        if (error) {
          return { status: 500, body: { error } };
        }
      }
      return { status: 200, body: { received: true } };
    }
    if (event.type === 'refund.updated') {
      return await onRefundUpdated(object, deps);
    }
    if (event.type === 'charge.dispute.created') {
      const intentId = intentIdOf(object.payment_intent) ?? '';
      await deps.audit('contestation', 'payment', intentId, {
        disputeId: asString(object.id),
        amount: asNumber(object.amount),
        currency: asString(object.currency),
      });
    }
    return { status: 200, body: { received: true } };
  } catch (error) {
    if (stripeAlreadyRefunded(error)) {
      return { status: 200, body: { received: true, alreadyRefunded: true } };
    }
    return { status: 500, body: { error: error instanceof Error ? error.message : 'Erreur webhook' } };
  }
}
