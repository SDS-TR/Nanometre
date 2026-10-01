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
  if (!supabaseUrl || !serviceKey || !stripeSecret) {
    return new Response('Configuration incomplète', { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('claim_refund_jobs');
  if (error) {
    return new Response(error.message, { status: 500 });
  }
  const jobs = (data ?? []) as { bookingId?: string; amount?: number; key?: string; intentId?: string }[];
  const stripe = new Stripe(stripeSecret, { apiVersion: STRIPE_API_VERSION, httpClient: Stripe.createFetchHttpClient() });
  let issued = 0;
  for (const job of jobs) {
    if (!job.key || !job.intentId || !job.amount || !job.bookingId) {
      continue;
    }
    try {
      await stripe.refunds.create(
        { payment_intent: job.intentId, amount: job.amount, metadata: { bookingId: job.bookingId } },
        { idempotencyKey: job.key },
      );
      await admin.rpc('mark_refund_job', { p_key: job.key, p_ok: true, p_error: null });
      issued += 1;
    } catch (refundError) {
      const already = stripeAlreadyRefunded(refundError);
      await admin.rpc('mark_refund_job', {
        p_key: job.key,
        p_ok: already,
        p_error: already ? null : refundError instanceof Error ? refundError.message : 'Stripe',
      });
      if (already) {
        issued += 1;
      }
    }
  }
  await admin.rpc('alert_stale_refunds');
  return new Response(JSON.stringify({ issued }), { headers: { 'content-type': 'application/json' } });
});
