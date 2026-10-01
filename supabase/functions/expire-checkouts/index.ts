import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import Stripe from 'npm:stripe@18.5.0';
import { STRIPE_API_VERSION, cronAuthorized, stripeAlreadyRefunded } from '../../../src/lib/payments.ts';

Deno.serve(async (req) => {
  if (!cronAuthorized(req.headers.get('Authorization'), Deno.env.get('CRON_SECRET'))) {
    return new Response('Accès refusé', { status: 403 });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response('Configuration incomplète', { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('expire_stale_checkouts');
  if (error) {
    return new Response(error.message, { status: 500 });
  }
  const jobs = (data ?? []) as { bookingId?: string; intentId?: string }[];
  if (stripeSecret) {
    const stripe = new Stripe(stripeSecret, { apiVersion: STRIPE_API_VERSION, httpClient: Stripe.createFetchHttpClient() });
    for (const job of jobs) {
      if (!job.intentId) {
        continue;
      }
      const intent = await stripe.paymentIntents.retrieve(job.intentId);
      try {
        if (intent.status === 'succeeded') {
          const amount = intent.amount_received;
          if (amount > 0) {
            await stripe.refunds.create(
              { payment_intent: intent.id, amount, metadata: { bookingId: job.bookingId ?? '' } },
              { idempotencyKey: `refund-${job.bookingId}-expire` },
            );
          }
        } else if (intent.status !== 'canceled') {
          await stripe.paymentIntents.cancel(intent.id);
        }
      } catch (error) {
        if (!stripeAlreadyRefunded(error)) {
          return new Response(error instanceof Error ? error.message : 'Stripe', { status: 500 });
        }
      }
    }
  }
  return new Response(JSON.stringify({ expired: jobs.length }), { headers: { 'content-type': 'application/json' } });
});
