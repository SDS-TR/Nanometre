import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import Stripe from 'npm:stripe@18.5.0';

const STRIPE_API_VERSION = '2025-08-27.basil';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Méthode refusée.' }, 405);
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'Supabase n’est pas configuré.' }, 500);
  }
  const authorization = req.headers.get('Authorization');
  if (!authorization) {
    return json({ error: 'Connecte-toi pour continuer.' }, 401);
  }
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: 'Session invalide.' }, 401);
  }
  const body = (await req.json().catch(() => null)) as { confirmation?: unknown } | null;
  if (body?.confirmation !== 'SUPPRIMER') {
    return json({ error: 'Écris SUPPRIMER pour confirmer.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: jobs, error: prepareError } = await admin.rpc('prepare_account_deletion', { p_user: userData.user.id });
  if (prepareError) {
    return json({ error: prepareError.message }, 409);
  }

  if (stripeSecret && Array.isArray(jobs)) {
    const stripe = new Stripe(stripeSecret, { apiVersion: STRIPE_API_VERSION, httpClient: Stripe.createFetchHttpClient() });
    for (const job of jobs as { bookingId?: string; intentId?: string; amount?: number }[]) {
      if (!job.intentId || !job.amount || !job.bookingId) {
        continue;
      }
      await stripe.refunds.create(
        { payment_intent: job.intentId, amount: job.amount, metadata: { bookingId: job.bookingId, kind: 'delete' } },
        { idempotencyKey: `refund-${job.bookingId}-delete` },
      );
    }
  }

  const { error: anonError } = await admin.rpc('anonymize_client', { p_user: userData.user.id });
  if (anonError) {
    return json({ error: anonError.message }, 500);
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(userData.user.id);
  if (deleteError) {
    return json({ error: 'Le compte n’a pas pu être supprimé.' }, 500);
  }
  return json({ deleted: true });
});
