import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import Stripe from 'npm:stripe@18.5.0';
import { accessLevel } from '../invite-team-member/logic.ts';
import { STRIPE_API_VERSION, stripeAlreadyRefunded } from '../_shared/payments.ts';
import { serve } from '../_shared/serve.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Méthode refusée.' }, 405);
  }
  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!stripeSecret || !supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'Stripe ou Supabase n’est pas configuré.' }, 500);
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
  const body = (await req.json().catch(() => null)) as { bookingId?: unknown; kind?: unknown } | null;
  const bookingId = body?.bookingId;
  const kind = body?.kind === 'fee' ? 'fee' : 'cancel';
  if (typeof bookingId !== 'string') {
    return json({ error: 'Rendez-vous manquant.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: booking } = await admin.from('bookings').select('id, client_id').eq('id', bookingId).maybeSingle();
  const { data: actor } = await admin.from('profiles').select('role, active').eq('id', userData.user.id).maybeSingle();
  const isOwner = actor?.role === 'proprietaire' && actor.active !== false;
  const owns = booking?.client_id === userData.user.id;
  if (!booking || (!owns && !isOwner)) {
    return json({ error: 'Accès refusé' }, 403);
  }
  if (!owns && accessLevel(authorization) !== 'aal2') {
    return json({ error: 'Vérification renforcée requise' }, 403);
  }
  if (kind === 'fee' && !isOwner) {
    return json({ error: 'Accès refusé' }, 403);
  }

  const idempotencyKey = kind === 'fee' ? `refund-${bookingId}-fee` : `refund-${bookingId}-cancel`;
  const claimed = await admin.rpc('claim_refund_job', { p_key: idempotencyKey });
  if (claimed.error) {
    return json({ error: claimed.error.message }, 500);
  }
  const job = claimed.data as { amount?: number; key?: string; intentId?: string } | null;
  if (!job?.intentId || !job.amount || !job.key) {
    return json({ issued: false });
  }
  const stripe = new Stripe(stripeSecret, { apiVersion: STRIPE_API_VERSION, httpClient: Stripe.createFetchHttpClient() });
  try {
    await stripe.refunds.create(
      { payment_intent: job.intentId, amount: job.amount, metadata: { bookingId, kind } },
      { idempotencyKey: job.key },
    );
  } catch (error) {
    if (!stripeAlreadyRefunded(error)) {
      await admin.rpc('mark_refund_job', { p_key: job.key, p_ok: false, p_error: error instanceof Error ? error.message : 'Stripe' });
      return json({ error: 'Remboursement Stripe impossible.' }, 502);
    }
  }
  await admin.rpc('mark_refund_job', { p_key: job.key, p_ok: true, p_error: null });
  return json({ issued: true });
});
