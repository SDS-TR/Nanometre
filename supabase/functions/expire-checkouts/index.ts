import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import Stripe from 'npm:stripe@18.5.0';

const STRIPE_API_VERSION = '2025-08-27.basil';

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  const authorization = req.headers.get('Authorization') ?? '';
  if (!secret || secret.length < 16 || authorization !== `Bearer ${secret}`) {
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
      if (intent.status === 'succeeded') {
        await stripe.refunds.create({ payment_intent: intent.id }, { idempotencyKey: `refund-${job.bookingId}-expire` });
      } else if (intent.status !== 'canceled') {
        await stripe.paymentIntents.cancel(intent.id);
      }
    }
  }
  return new Response(JSON.stringify({ expired: jobs.length }), { headers: { 'content-type': 'application/json' } });
});
