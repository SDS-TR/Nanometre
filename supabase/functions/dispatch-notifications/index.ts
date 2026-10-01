import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

type Ticket = { status?: string; details?: { error?: string } };

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  const authorization = req.headers.get('Authorization') ?? '';
  if (!secret || secret.length < 16 || authorization !== `Bearer ${secret}`) {
    return new Response('Accès refusé', { status: 403 });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response('Configuration incomplète', { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: jobs, error } = await supabase
    .from('notification_jobs')
    .update({ status: 'en_cours' })
    .eq('status', 'planifie')
    .lte('send_at', new Date().toISOString())
    .select('id, user_id, title, body, path')
    .limit(50);
  if (error) {
    return new Response(error.message, { status: 500 });
  }

  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  for (const job of jobs ?? []) {
    const { data: tokens } = await supabase.from('push_tokens').select('token').eq('user_id', job.user_id);
    const messages = (tokens ?? []).map((row) => ({
      to: row.token,
      title: job.title,
      body: job.body,
      data: { path: job.path },
    }));
    let failed = false;
    if (messages.length > 0) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (accessToken) {
        headers.authorization = `Bearer ${accessToken}`;
      }
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers,
        body: JSON.stringify(messages),
      });
      if (!response.ok) {
        failed = true;
      } else {
        const payload = (await response.json().catch(() => null)) as { data?: Ticket[] } | null;
        const tickets = payload?.data ?? [];
        failed = tickets.some((ticket) => ticket.status === 'error');
        for (let index = 0; index < tickets.length; index += 1) {
          if (tickets[index]?.details?.error === 'DeviceNotRegistered') {
            await supabase.from('push_tokens').delete().eq('token', messages[index]?.to ?? '');
          }
        }
      }
    }
    await supabase
      .from('notification_jobs')
      .update({ status: failed ? 'echec' : 'envoye' })
      .eq('id', job.id);
  }
  return new Response(JSON.stringify({ sent: jobs?.length ?? 0 }), { headers: { 'content-type': 'application/json' } });
});
