import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { cronAuthorized } from '../../../src/lib/payments.ts';

Deno.serve(async (req) => {
  if (!cronAuthorized(req.headers.get('Authorization'), Deno.env.get('CRON_SECRET'))) {
    return new Response('Accès refusé', { status: 403 });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response('Configuration incomplète', { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.rpc('purge_client_notes');
  if (error) {
    return new Response(error.message, { status: 500 });
  }
  return new Response(JSON.stringify({ purged: true }), { headers: { 'content-type': 'application/json' } });
});
