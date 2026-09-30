import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import Stripe from 'npm:stripe@18.5.0';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
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

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: 'Session invalide.' }, 401);
  }

  const body = (await req.json().catch(() => null)) as { bookingId?: unknown } | null;
  const bookingId = body?.bookingId;
  if (typeof bookingId !== 'string') {
    return json({ error: 'Rendez-vous manquant.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: booking, error } = await admin
    .from('bookings')
    .select('id, client_id, total_cents, status')
    .eq('id', bookingId)
    .maybeSingle();
  if (error || !booking || booking.client_id !== userData.user.id) {
    return json({ error: 'Rendez-vous introuvable.' }, 404);
  }
  if (booking.status !== 'en_attente_paiement') {
    return json({ error: 'Ce rendez-vous n’attend pas de paiement.' }, 409);
  }
  if (booking.total_cents <= 0) {
    return json({ error: 'Aucun montant à encaisser.' }, 400);
  }

  const stripe = new Stripe(stripeSecret);
  const { data: payment } = await admin
    .from('payments')
    .select('stripe_payment_intent_id')
    .eq('booking_id', bookingId)
    .maybeSingle();

  if (payment?.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);
    if (existing.client_secret && existing.status !== 'canceled') {
      return json({ clientSecret: existing.client_secret });
    }
  }

  const intent = await stripe.paymentIntents.create({
    amount: booking.total_cents,
    currency: 'cad',
    automatic_payment_methods: { enabled: true },
    metadata: { bookingId },
  });
  await admin.from('payments').update({ stripe_payment_intent_id: intent.id }).eq('booking_id', bookingId);
  return json({ clientSecret: intent.client_secret });
});
