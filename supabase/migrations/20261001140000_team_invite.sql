-- L'invitation Auth est faite par la fonction Edge invite-team-member (service role).
-- Cette RPC ne crée pas de compte et ne renvoie aucun secret.

create or replace function public.admin_invite(p_email text, p_name text, p_role public.user_role, p_barber uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('team');
  raise exception 'L’invitation se fait par le serveur.';
end;
$$;
