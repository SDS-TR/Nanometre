import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import Stripe from 'npm:stripe@18.5.0';

const STRIPE_API_VERSION = '2025-08-27.basil';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Méthode refusée.' }, 405);
  }
  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
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
  const body = (await req.json().catch(() => null)) as { bookingId?: unknown } | null;
  if (typeof body?.bookingId !== 'string') {
    return json({ error: 'Rendez-vous manquant.' }, 400);
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: payment } = await admin
    .from('payments')
    .select('stripe_payment_intent_id')
    .eq('booking_id', body.bookingId)
    .maybeSingle();

  let refund = false;
  if (payment?.stripe_payment_intent_id) {
    if (!stripeSecret) {
      return json({ error: 'Stripe n’est pas configuré.' }, 500);
    }
    const stripe = new Stripe(stripeSecret, { apiVersion: STRIPE_API_VERSION, httpClient: Stripe.createFetchHttpClient() });
    const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);
    if (intent.status === 'succeeded') {
      await stripe.refunds.create(
        { payment_intent: intent.id, metadata: { bookingId: body.bookingId } },
        { idempotencyKey: `refund-${body.bookingId}-abandon` },
      );
      refund = true;
    } else if (intent.status !== 'canceled') {
      await stripe.paymentIntents.cancel(intent.id);
    }
  }

  const { error } = await admin.rpc('service_finish_abandon', {
    p_booking: body.bookingId,
    p_user: userData.user.id,
    p_refund: refund,
  });
  if (error) {
    return json({ error: error.message }, 409);
  }
  return json({ abandoned: true });
});
