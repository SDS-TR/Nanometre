import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import Stripe from 'npm:stripe@18.5.0';
import { STRIPE_API_VERSION, stripeAlreadyRefunded } from '../../../src/lib/payments.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const TEN_MINUTES = 10 * 60 * 1000;

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
  const body = (await req.json().catch(() => null)) as { confirmation?: unknown; password?: unknown } | null;
  if (body?.confirmation !== 'SUPPRIMER') {
    return json({ error: 'Écris SUPPRIMER pour confirmer.' }, 400);
  }
  const signedIn = userData.user.last_sign_in_at ? Date.parse(userData.user.last_sign_in_at) : 0;
  if (!Number.isFinite(signedIn) || Date.now() - signedIn > TEN_MINUTES) {
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!userData.user.email || password.length < 8) {
      return json({ error: 'Confirme ton mot de passe pour supprimer le compte.' }, 401);
    }
    const again = await userClient.auth.signInWithPassword({ email: userData.user.email, password });
    if (again.error) {
      return json({ error: 'Mot de passe refusé.' }, 401);
    }
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: prepareError } = await admin.rpc('prepare_account_deletion', { p_user: userData.user.id });
  if (prepareError) {
    return json({ error: prepareError.message }, 409);
  }
  const pending = await admin.rpc('pending_refund_jobs', { p_user: userData.user.id });
  if (pending.error) {
    return json({ error: pending.error.message }, 500);
  }
  const jobs = (pending.data ?? []) as { bookingId?: string; intentId?: string; amount?: number; key?: string }[];
  if (jobs.length > 0 && !stripeSecret) {
    return json({ error: 'Le remboursement n’est pas configuré. Le compte n’a pas été supprimé.' }, 500);
  }
  if (stripeSecret) {
    const stripe = new Stripe(stripeSecret, { apiVersion: STRIPE_API_VERSION, httpClient: Stripe.createFetchHttpClient() });
    for (const job of jobs) {
      if (!job.intentId || !job.amount || !job.bookingId || !job.key) {
        continue;
      }
      try {
        await stripe.refunds.create(
          { payment_intent: job.intentId, amount: job.amount, metadata: { bookingId: job.bookingId, kind: 'delete' } },
          { idempotencyKey: job.key },
        );
        await admin.rpc('mark_refund_job', { p_key: job.key, p_ok: true, p_error: null });
      } catch (error) {
        if (!stripeAlreadyRefunded(error)) {
          await admin.rpc('mark_refund_job', { p_key: job.key, p_ok: false, p_error: error instanceof Error ? error.message : 'Stripe' });
          return json({ error: 'Remboursement Stripe impossible. Le compte n’a pas été supprimé.' }, 502);
        }
        await admin.rpc('mark_refund_job', { p_key: job.key, p_ok: true, p_error: null });
      }
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
