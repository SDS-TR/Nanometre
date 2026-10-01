import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { inviteAck, planTeamInvite } from './logic.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Méthode refusée.' }, 405);
  }
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

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: 'Session invalide.' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: actor } = await admin
    .from('profiles')
    .select('role, active')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (!actor || actor.role !== 'proprietaire' || actor.active === false) {
    return json({ error: 'Accès refusé' }, 403);
  }

  let plan;
  try {
    plan = planTeamInvite(await req.json().catch(() => ({})));
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : 'Invitation incomplète.';
    return json({ error: message }, message === 'Accès refusé' ? 403 : 400);
  }

  if (plan.barberId) {
    const { data: barber } = await admin.from('barbers').select('id').eq('id', plan.barberId).maybeSingle();
    if (!barber) {
      return json({ error: 'Coiffeur introuvable.' }, 400);
    }
  }

  const redirectTo = Deno.env.get('INVITE_REDIRECT_URL') ?? 'lenanometre://auth/callback';
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(plan.email, {
    data: plan.metadata,
    redirectTo,
  });
  if (inviteError || !invited.user) {
    const already = (inviteError?.message ?? '').toLowerCase().includes('already');
    return json({ error: already ? 'Ce courriel a déjà un compte.' : 'Invitation impossible.' }, 409);
  }

  const { error: profileError } = await admin.from('profiles').upsert({
    id: invited.user.id,
    full_name: plan.fullName,
    role: plan.role,
    barber_id: plan.barberId,
    active: true,
  });
  if (profileError) {
    return json({ error: 'Le profil n’a pas pu être lié.' }, 500);
  }

  const { error: auditError } = await admin.from('audit_log').insert({
    actor_id: userData.user.id,
    action: plan.audit.action,
    entity: plan.audit.entity,
    entity_id: invited.user.id,
    detail: plan.audit.detail,
  });
  if (auditError) {
    return json({ error: 'Le journal n’a pas pu être écrit.' }, 500);
  }

  return json(inviteAck());
});
