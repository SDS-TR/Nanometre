import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { orphanRefundCents } from '../lib/payments';
import { handleStripeEvent, type StripeClaim, type WebhookDeps, type WebhookEvent } from '../lib/stripeWebhook';

const secret = `whsec_${'a'.repeat(32)}`;
const stripe = new Stripe('sk_test_51Nanometre', { apiVersion: '2025-08-27.basil' });

function signed(object: Record<string, unknown>, type: string, id = 'evt_test'): WebhookEvent {
  const payload = JSON.stringify({
    id,
    object: 'event',
    api_version: '2025-08-27.basil',
    type,
    data: { object },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return stripe.webhooks.constructEvent(payload, header, secret) as unknown as WebhookEvent;
}

function deps(partial: Partial<WebhookDeps> = {}): WebhookDeps {
  return {
    claimEvent: vi.fn(async () => 'acquis' as const),
    finishEvent: vi.fn(async () => undefined),
    getBooking: vi.fn(async () => ({ id: 'b1', status: 'en_attente_paiement' })),
    getPayment: vi.fn(async () => ({ feeCents: 0, stripeRefundCents: 0 })),
    confirmPayment: vi.fn(async () => null),
    syncRefund: vi.fn(async () => null),
    audit: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    refund: vi.fn(async () => undefined),
    retrieveCharge: vi.fn(async () => ({ amountRefunded: 3574, paymentIntentId: 'pi_1' })),
    ...partial,
  };
}

describe('webhook Stripe signé', () => {
  it('rejette une signature fausse et accepte une charge signée', () => {
    expect(() => stripe.webhooks.constructEvent('{}', 't=1,v1=deadbeef', secret)).toThrow();
    const event = signed({ id: 'pi_1', object: 'payment_intent', amount_received: 6324, currency: 'cad', metadata: { bookingId: 'b1' } }, 'payment_intent.succeeded');
    expect(event.type).toBe('payment_intent.succeeded');
    expect(event.id).toBe('evt_test');
  });

  it('ignore un événement déjà vu', async () => {
    const confirmPayment = vi.fn(async () => null);
    const result = await handleStripeEvent(
      signed({ id: 'pi_1', object: 'payment_intent', amount_received: 6324, currency: 'cad', metadata: { bookingId: 'b1' } }, 'payment_intent.succeeded', 'evt_dup'),
      deps({ claimEvent: async () => 'traite', confirmPayment }),
    );
    expect(result.status).toBe(200);
    expect(result.body.duplicate).toBe(true);
    expect(confirmPayment).not.toHaveBeenCalled();
  });

  it('confirme le montant reçu et ne boucle pas sur un écart', async () => {
    const confirmPayment = vi.fn(async () => null);
    const ok = await handleStripeEvent(
      signed({ id: 'pi_1', object: 'payment_intent', amount_received: 6324, currency: 'cad', metadata: { bookingId: 'b1' } }, 'payment_intent.succeeded', 'evt_ok'),
      deps({ confirmPayment }),
    );
    expect(ok.status).toBe(200);
    expect(confirmPayment).toHaveBeenCalledWith({ bookingId: 'b1', intentId: 'pi_1', amount: 6324, currency: 'cad' });

    const audit = vi.fn(async () => undefined);
    const mismatch = await handleStripeEvent(
      signed({ id: 'pi_1', object: 'payment_intent', amount_received: 1, currency: 'cad', metadata: { bookingId: 'b1' } }, 'payment_intent.succeeded', 'evt_bad'),
      deps({ confirmPayment: async () => 'Paiement incohérent', audit }),
    );
    expect(mismatch.status).toBe(200);
    expect(mismatch.body.ignored).toBe(true);
    expect(audit).toHaveBeenCalled();
  });

  it('ne rembourse pas les frais déjà retenus sur un paiement orphelin', async () => {
    const refund = vi.fn(async () => undefined);
    const result = await handleStripeEvent(
      signed(
        { id: 'pi_1', object: 'payment_intent', amount_received: 6324, currency: 'cad', metadata: { bookingId: 'b1' } },
        'payment_intent.succeeded',
        'evt_orphan',
      ),
      deps({
        getBooking: async () => ({ id: 'b1', status: 'annule_tardif' }),
        getPayment: async () => ({ feeCents: 2750, stripeRefundCents: 0 }),
        refund,
      }),
    );
    expect(result.status).toBe(200);
    expect(orphanRefundCents({ amountReceived: 6324, feeCents: 2750, stripeRefundCents: 0 })).toBe(3574);
    expect(refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 3574, idempotencyKey: 'refund-b1-orphan' }));
  });

  it('répond 200 si la charge est déjà remboursée', async () => {
    const result = await handleStripeEvent(
      signed(
        { id: 'pi_1', object: 'payment_intent', amount_received: 6324, currency: 'cad', metadata: { bookingId: 'b1' } },
        'payment_intent.succeeded',
        'evt_already',
      ),
      deps({
        getBooking: async () => null,
        refund: async () => {
          const error = new Error('Charge ch_1 has already been refunded');
          (error as { code?: string }).code = 'charge_already_refunded';
          throw error;
        },
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body.alreadyRefunded).toBe(true);
  });

  it('synchronise le cumul de la charge, pas le montant d’un seul remboursement', async () => {
    const syncRefund = vi.fn(async () => null);
    const charge = await handleStripeEvent(
      signed({ id: 'ch_1', object: 'charge', amount_refunded: 6324, payment_intent: 'pi_1' }, 'charge.refunded', 'evt_charge'),
      deps({ syncRefund }),
    );
    expect(charge.status).toBe(200);
    expect(syncRefund).toHaveBeenCalledWith('pi_1', 6324);

    syncRefund.mockClear();
    const updated = await handleStripeEvent(
      signed({ id: 're_1', object: 'refund', amount: 1000, status: 'succeeded', charge: 'ch_1', payment_intent: 'pi_1' }, 'refund.updated', 'evt_refund'),
      deps({
        syncRefund,
        retrieveCharge: async () => ({ amountRefunded: 6324, paymentIntentId: 'pi_1' }),
      }),
    );
    expect(updated.status).toBe(200);
    expect(syncRefund).toHaveBeenCalledWith('pi_1', 6324);

    syncRefund.mockClear();
    const pending = await handleStripeEvent(
      signed({ id: 're_2', object: 'refund', amount: 1000, status: 'pending', charge: 'ch_1' }, 'refund.updated', 'evt_pending'),
      deps({ syncRefund }),
    );
    expect(pending.body.ignored).toBe(true);
    expect(syncRefund).not.toHaveBeenCalled();
  });

  it('relâche un échec puis traite la relivraison', async () => {
    const state = new Map<string, 'en_cours' | 'traite'>();
    let confirms = 0;
    const claimEvent = async (id: string): Promise<StripeClaim> => {
      const current = state.get(id);
      if (current === 'traite' || current === 'en_cours') {
        return current;
      }
      state.set(id, 'en_cours');
      return 'acquis';
    };
    const finishEvent = async (id: string, ok: boolean) => {
      if (ok) {
        state.set(id, 'traite');
      } else {
        state.delete(id);
      }
    };
    const confirmPayment = vi.fn(async () => {
      confirms += 1;
      return confirms === 1 ? 'base indisponible' : null;
    });
    const event = signed(
      { id: 'pi_1', object: 'payment_intent', amount_received: 6324, currency: 'cad', metadata: { bookingId: 'b1' } },
      'payment_intent.succeeded',
      'evt_retry',
    );
    const wired = () => deps({ claimEvent, finishEvent, confirmPayment });
    const first = await handleStripeEvent(event, wired());
    expect(first.status).toBe(500);
    expect(state.has('evt_retry')).toBe(false);
    const second = await handleStripeEvent(event, wired());
    expect(second.status).toBe(200);
    expect(confirms).toBe(2);
    expect(state.get('evt_retry')).toBe('traite');
    const third = await handleStripeEvent(event, wired());
    expect(third.body.duplicate).toBe(true);
    expect(confirms).toBe(2);
  });

  it('répond 503 pendant le bail pour que Stripe relivre', async () => {
    const finishEvent = vi.fn(async () => undefined);
    const confirmPayment = vi.fn(async () => null);
    const result = await handleStripeEvent(
      signed(
        { id: 'pi_1', object: 'payment_intent', amount_received: 6324, currency: 'cad', metadata: { bookingId: 'b1' } },
        'payment_intent.succeeded',
        'evt_busy',
      ),
      deps({ claimEvent: async () => 'en_cours', finishEvent, confirmPayment }),
    );
    expect(result.status).toBe(503);
    expect(confirmPayment).not.toHaveBeenCalled();
    expect(finishEvent).not.toHaveBeenCalled();
  });
});
