import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import Stripe from 'npm:stripe@18.5.0';

const STRIPE_API_VERSION = '2025-08-27.basil';

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

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent;
    const bookingId = pi.metadata?.bookingId;
    if (!bookingId) {
      return new Response('Rendez-vous manquant', { status: 400 });
    }
    const { data: booking } = await admin.from('bookings').select('id, status').eq('id', bookingId).maybeSingle();
    if (!booking || booking.status === 'annule' || booking.status === 'annule_tardif') {
      await stripe.refunds.create(
        { payment_intent: pi.id, metadata: { bookingId } },
        { idempotencyKey: `refund-${bookingId}-orphan` },
      );
      await admin.from('audit_log').insert({
        action: 'remboursement_orphelin',
        entity: 'booking',
        entity_id: bookingId,
        detail: { intentId: pi.id, amount: pi.amount_received, currency: pi.currency },
      });
      return new Response(JSON.stringify({ received: true, refunded: true }), { status: 200 });
    }
    const { error } = await admin.rpc('confirm_online_payment', {
      p_booking: bookingId,
      p_intent: pi.id,
      p_amount: pi.amount_received,
      p_currency: pi.currency,
    });
    if (error) {
      return new Response(error.message, { status: 500 });
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object as Stripe.PaymentIntent;
    await admin.from('payments').update({ status: 'echoue' }).eq('stripe_payment_intent_id', pi.id).eq('status', 'en_attente');
  }

  if (event.type === 'charge.refunded' || event.type === 'refund.updated') {
    const object = event.data.object as Stripe.Charge | Stripe.Refund;
    const intent = 'payment_intent' in object ? object.payment_intent : null;
    const intentId = typeof intent === 'string' ? intent : intent?.id;
    const refunded = 'amount_refunded' in object ? object.amount_refunded : object.amount;
    if (intentId && typeof refunded === 'number') {
      const { error } = await admin.rpc('sync_stripe_refund', { p_intent: intentId, p_refunded: refunded });
      if (error) {
        return new Response(error.message, { status: 500 });
      }
    }
  }

  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object as Stripe.Dispute;
    const intent = dispute.payment_intent;
    const intentId = typeof intent === 'string' ? intent : intent?.id ?? '';
    await admin.from('audit_log').insert({
      action: 'contestation',
      entity: 'payment',
      entity_id: intentId,
      detail: { disputeId: dispute.id, amount: dispute.amount, currency: dispute.currency },
    });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
