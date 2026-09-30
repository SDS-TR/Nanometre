import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import Stripe from 'npm:stripe@18.5.0';

Deno.serve(async (req) => {
  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!stripeSecret || !webhookSecret || !supabaseUrl || !serviceKey) {
    return new Response('Configuration incomplète', { status: 500 });
  }
  const stripe = new Stripe(stripeSecret);
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Signature absente', { status: 400 });
  }
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), signature, webhookSecret);
  } catch {
    return new Response('Signature invalide', { status: 400 });
  }
  if (event.type === 'payment_intent.succeeded') {
    const bookingId = event.data.object.metadata.bookingId;
    if (bookingId) {
      const admin = createClient(supabaseUrl, serviceKey);
      const { error } = await admin.rpc('confirm_online_payment', { p_booking: bookingId });
      if (error) {
        return new Response(error.message, { status: 500 });
      }
    }
  }
  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
