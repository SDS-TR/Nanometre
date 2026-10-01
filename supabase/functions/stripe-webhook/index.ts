import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import Stripe from 'npm:stripe@18.5.0';
import { STRIPE_API_VERSION } from '../../../src/lib/payments.ts';
import { handleStripeEvent, type WebhookEvent } from '../../../src/lib/stripeWebhook.ts';

Deno.serve(async (req) => {
  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!stripeSecret || !webhookSecret || !supabaseUrl || !serviceKey) {
    return new Response('Configuration incomplète', { status: 500 });
  }
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Signature manquante', { status: 400 });
  }
  const stripe = new Stripe(stripeSecret, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });
  const cryptoProvider = Stripe.createSubtleCryptoProvider();
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret, undefined, cryptoProvider);
  } catch {
    return new Response('Signature invalide', { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const result = await handleStripeEvent(event as unknown as WebhookEvent, {
    claimEvent: async (id) => {
      const { data, error } = await admin.rpc('claim_stripe_event', { p_id: id });
      if (error) {
        throw new Error(error.message);
      }
      return data === true;
    },
    getBooking: async (id) => {
      const { data } = await admin.from('bookings').select('id, status').eq('id', id).maybeSingle();
      return data;
    },
    getPayment: async (bookingId) => {
      const { data } = await admin
        .from('payments')
        .select('fee_cents, stripe_refund_cents')
        .eq('booking_id', bookingId)
        .maybeSingle();
      if (!data) {
        return null;
      }
      return { feeCents: data.fee_cents, stripeRefundCents: data.stripe_refund_cents };
    },
    confirmPayment: async ({ bookingId, intentId, amount, currency }) => {
      const { error } = await admin.rpc('confirm_online_payment', {
        p_booking: bookingId,
        p_intent: intentId,
        p_amount: amount,
        p_currency: currency,
      });
      return error?.message ?? null;
    },
    syncRefund: async (intentId, refunded) => {
      const { error } = await admin.rpc('sync_stripe_refund', { p_intent: intentId, p_refunded: refunded });
      return error?.message ?? null;
    },
    audit: async (action, entity, entityId, detail) => {
      await admin.from('audit_log').insert({ action, entity, entity_id: entityId, detail });
    },
    markFailed: async (intentId) => {
      await admin.from('payments').update({ status: 'echoue' }).eq('stripe_payment_intent_id', intentId).eq('status', 'en_attente');
    },
    refund: async ({ paymentIntent, amount, bookingId, idempotencyKey }) => {
      await stripe.refunds.create(
        { payment_intent: paymentIntent, amount, metadata: { bookingId } },
        { idempotencyKey },
      );
    },
    retrieveCharge: async (chargeId) => {
      const charge = await stripe.charges.retrieve(chargeId);
      const intent = charge.payment_intent;
      return {
        amountRefunded: charge.amount_refunded,
        paymentIntentId: typeof intent === 'string' ? intent : intent?.id ?? null,
      };
    },
  });
  return new Response(JSON.stringify(result.body), { status: result.status });
});
