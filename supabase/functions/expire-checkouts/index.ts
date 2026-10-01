import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import Stripe from 'npm:stripe@18.5.0';
import { STRIPE_API_VERSION, cronAuthorized, stripeAlreadyRefunded } from '../_shared/payments.ts';
import { serve } from '../_shared/serve.ts';

type IntentJob = { bookingId?: string; intentId?: string };

serve(async (req) => {
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
  const expired = await admin.rpc('expire_stale_checkouts');
  if (expired.error) {
    return new Response(expired.error.message, { status: 500 });
  }
  if (!stripeSecret) {
    return new Response(JSON.stringify({ expired: 0, pending: true }), { headers: { 'content-type': 'application/json' } });
  }
  const claimed = await admin.rpc('claim_intent_jobs');
  if (claimed.error) {
    return new Response(claimed.error.message, { status: 500 });
  }
  const jobs = (claimed.data ?? []) as IntentJob[];
  const stripe = new Stripe(stripeSecret, { apiVersion: STRIPE_API_VERSION, httpClient: Stripe.createFetchHttpClient() });
  let failed = 0;
  for (const job of jobs) {
    if (!job.intentId || !job.bookingId) {
      continue;
    }
    try {
      const intent = await stripe.paymentIntents.retrieve(job.intentId);
      if (intent.status === 'succeeded') {
        const amount = intent.amount_received;
        if (amount > 0) {
          await stripe.refunds.create(
            { payment_intent: intent.id, amount, metadata: { bookingId: job.bookingId } },
            { idempotencyKey: `refund-${job.bookingId}-expire` },
          );
        }
      } else if (intent.status !== 'canceled') {
        await stripe.paymentIntents.cancel(intent.id);
      }
      await admin.rpc('mark_intent_job', { p_booking: job.bookingId, p_intent: job.intentId, p_ok: true, p_error: null });
    } catch (error) {
      const already = stripeAlreadyRefunded(error);
      await admin.rpc('mark_intent_job', {
        p_booking: job.bookingId,
        p_intent: job.intentId,
        p_ok: already,
        p_error: already ? null : error instanceof Error ? error.message : 'Stripe',
      });
      if (!already) {
        failed += 1;
      }
    }
  }
  return new Response(JSON.stringify({ expired: jobs.length, failed }), {
    status: failed > 0 ? 500 : 200,
    headers: { 'content-type': 'application/json' },
  });
});
