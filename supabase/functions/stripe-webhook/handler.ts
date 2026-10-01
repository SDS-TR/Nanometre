import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import Stripe from 'npm:stripe@18.5.0';
import { STRIPE_API_VERSION } from '../_shared/payments.ts';
import { handleStripeEvent, type WebhookEvent } from '../_shared/stripeWebhook.ts';

export type WebhookAdmin = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => {
    select: (columns: string) => WebhookFilter;
    insert: (row: Record<string, unknown>) => PromiseLike<unknown>;
    update: (row: Record<string, unknown>) => WebhookFilter;
  };
};

type WebhookFilter = {
  eq: (column: string, value: unknown) => WebhookFilter;
  maybeSingle: () => PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
};

export type WebhookRuntime = {
  stripeSecret: string;
  webhookSecret: string;
  admin: WebhookAdmin;
  stripe: Stripe;
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function runtimeFromEnv(): WebhookRuntime | { missing: true } {
  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!stripeSecret || !webhookSecret || !supabaseUrl || !serviceKey) {
    return { missing: true };
  }
  const stripe = new Stripe(stripeSecret, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  return { stripeSecret, webhookSecret, admin: admin as unknown as WebhookAdmin, stripe };
}

export async function handleWebhookRequest(req: Request, runtime: WebhookRuntime | { missing: true }): Promise<Response> {
  if ('missing' in runtime) {
    return new Response('Configuration incomplète', { status: 500 });
  }
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Signature manquante', { status: 400 });
  }
  const { stripe, webhookSecret, admin } = runtime;
  const cryptoProvider = Stripe.createSubtleCryptoProvider();
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret, undefined, cryptoProvider);
  } catch {
    return new Response('Signature invalide', { status: 400 });
  }
  const result = await handleStripeEvent(event as unknown as WebhookEvent, {
    claimEvent: async (id) => {
      const { data, error } = await admin.rpc('claim_stripe_event', { p_id: id });
      if (error) {
        throw new Error(error.message);
      }
      return data === true;
    },
    finishEvent: async (id, ok) => {
      const { error } = await admin.rpc('finish_stripe_event', { p_id: id, p_ok: ok });
      if (error) {
        throw new Error(error.message);
      }
    },
    getBooking: async (id) => {
      const { data } = await admin.from('bookings').select('id, status').eq('id', id).maybeSingle();
      return data ? { id: String(data.id), status: String(data.status) } : null;
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
      return { feeCents: Number(data.fee_cents), stripeRefundCents: Number(data.stripe_refund_cents) };
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
  return json(result.body, result.status);
}
