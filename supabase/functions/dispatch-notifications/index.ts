import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

Deno.serve(async () => {
  const { data: jobs, error } = await supabase
    .from('notification_jobs')
    .select('id, user_id, title, body, path')
    .eq('status', 'planifie')
    .lte('send_at', new Date().toISOString())
    .limit(50);
  if (error) {
    return new Response(error.message, { status: 500 });
  }
  for (const job of jobs ?? []) {
    const { data: tokens } = await supabase.from('push_tokens').select('token').eq('user_id', job.user_id);
    const messages = (tokens ?? []).map((row) => ({
      to: row.token,
      title: job.title,
      body: job.body,
      data: { path: job.path },
    }));
    if (messages.length > 0) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(messages),
      });
    }
    await supabase.from('notification_jobs').update({ status: 'envoye' }).eq('id', job.id);
  }
  return new Response(JSON.stringify({ sent: jobs?.length ?? 0 }), { headers: { 'content-type': 'application/json' } });
});
