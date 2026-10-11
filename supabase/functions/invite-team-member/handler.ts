import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { accessLevel, inviteAck, planTeamInvite, type StaffInviteRole } from './logic.ts';

/** Accès serveur dont la fonction a besoin. Injecté pour les tests Deno. */
export type InviteRuntime = {
  /** Vérifie la signature du jeton auprès d’Auth et rend l’utilisateur. */
  getUser(authorization: string): Promise<{ id: string } | null>;
  getActor(userId: string): Promise<{ role: string; active: boolean | null } | null>;
  /** F-5 : compte la tentative en base. false au-delà du plafond horaire. */
  claimInviteAttempt(ownerId: string): Promise<boolean>;
  getBarber(barberId: string): Promise<{ id: string; active: boolean } | null>;
  inviteUserByEmail(
    email: string,
    options: { data: { full_name: string }; redirectTo: string },
  ): Promise<{ userId: string | null; errorMessage: string | null }>;
  upsertProfile(profile: {
    id: string;
    full_name: string;
    role: StaffInviteRole;
    barber_id: string | null;
    active: false;
    invited_at: string;
  }): Promise<{ ok: boolean }>;
  insertAudit(entry: {
    actor_id: string;
    action: string;
    entity: string;
    entity_id: string;
    detail: unknown;
  }): Promise<{ ok: boolean }>;
  redirectTo: string;
};

export const INVITE_LIMIT_MESSAGE = 'Trop d’invitations envoyées. Réessaie dans une heure.';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export function runtimeFromEnv(): InviteRuntime | { missing: true } {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return { missing: true };
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    async getUser(authorization) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authorization } },
      });
      const { data, error } = await userClient.auth.getUser();
      return error || !data.user ? null : { id: data.user.id };
    },
    async getActor(userId) {
      const { data } = await admin.from('profiles').select('role, active').eq('id', userId).maybeSingle();
      return data;
    },
    async claimInviteAttempt(ownerId) {
      const { data, error } = await admin.rpc('claim_invite_attempt', { p_owner: ownerId });
      // En cas d’erreur, on refuse : le plafond ne s’ouvre jamais par défaut.
      return !error && data === true;
    },
    async getBarber(barberId) {
      const { data } = await admin.from('barbers').select('id, active').eq('id', barberId).maybeSingle();
      return data;
    },
    async inviteUserByEmail(email, options) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, options);
      return { userId: data?.user?.id ?? null, errorMessage: error?.message ?? null };
    },
    async upsertProfile(profile) {
      const { error } = await admin.from('profiles').upsert(profile);
      return { ok: !error };
    },
    async insertAudit(entry) {
      const { error } = await admin.from('audit_log').insert(entry);
      return { ok: !error };
    },
    // Le modèle Auth « Invite user » doit être
    // https://lenanometre.ca/auth/callback?token_hash={{ .TokenHash }}&type=invite
    // Le client est en PKCE et refuse le fragment #access_token= de l'invitation par défaut.
    redirectTo: Deno.env.get('INVITE_REDIRECT_URL') ?? 'https://lenanometre.ca/auth/callback',
  };
}

export async function handleInviteRequest(req: Request, runtime: InviteRuntime | { missing: true }): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Méthode refusée.' }, 405);
  }
  if ('missing' in runtime) {
    return json({ error: 'Supabase n’est pas configuré.' }, 500);
  }
  const authorization = req.headers.get('Authorization');
  if (!authorization) {
    return json({ error: 'Connecte-toi pour continuer.' }, 401);
  }

  // La signature du jeton est vérifiée par Auth avant toute lecture de son claim aal.
  const user = await runtime.getUser(authorization);
  if (!user) {
    return json({ error: 'Session invalide.' }, 401);
  }

  const actor = await runtime.getActor(user.id);
  if (!actor || actor.role !== 'proprietaire' || actor.active === false) {
    return json({ error: 'Accès refusé' }, 403);
  }

  // E-1 : toute invitation crée un accès durable aux données clients. aal2 pour tous les rôles.
  if (accessLevel(authorization) !== 'aal2') {
    return json({ error: 'Vérification renforcée requise' }, 403);
  }

  let plan;
  try {
    plan = planTeamInvite(await req.json().catch(() => ({})));
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : 'Invitation incomplète.';
    return json({ error: message }, message === 'Accès refusé' ? 403 : 400);
  }

  // F-5 (KEY-12) : plafond par propriétaire, compté en base avant tout envoi.
  if (!(await runtime.claimInviteAttempt(user.id))) {
    return json({ error: INVITE_LIMIT_MESSAGE }, 429);
  }

  if (plan.barberId) {
    const barber = await runtime.getBarber(plan.barberId);
    if (!barber) {
      return json({ error: 'Coiffeur introuvable.' }, 400);
    }
    if (barber.active === false) {
      return json({ error: 'Ce coiffeur est retiré. Réactive-le avant de l’inviter.' }, 400);
    }
  }

  const invited = await runtime.inviteUserByEmail(plan.email, {
    data: plan.metadata,
    redirectTo: runtime.redirectTo,
  });
  if (invited.errorMessage || !invited.userId) {
    const already = (invited.errorMessage ?? '').toLowerCase().includes('already');
    return json({ error: already ? 'Ce courriel a déjà un compte.' : 'Invitation impossible.' }, 409);
  }

  const profile = await runtime.upsertProfile({
    id: invited.userId,
    full_name: plan.fullName,
    role: plan.role,
    barber_id: plan.barberId,
    active: false,
    invited_at: new Date().toISOString(),
  });
  if (!profile.ok) {
    return json({ error: 'Le profil n’a pas pu être lié.' }, 500);
  }

  const audit = await runtime.insertAudit({
    actor_id: user.id,
    action: plan.audit.action,
    entity: plan.audit.entity,
    entity_id: invited.userId,
    detail: plan.audit.detail,
  });
  if (!audit.ok) {
    return json({ error: 'Le journal n’a pas pu être écrit.' }, 500);
  }

  return json(inviteAck());
}
