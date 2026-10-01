-- Une relivraison pendant le bail ne doit pas être un succès : Stripe doit réessayer.

drop function public.claim_stripe_event(text);

create function public.claim_stripe_event(p_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
  v_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  with upsert as (
    insert into public.stripe_events (id, status, updated_at)
    values (p_id, 'en_cours', now())
    on conflict (id) do update
      set status = 'en_cours', updated_at = now()
      where public.stripe_events.status = 'en_cours'
        and public.stripe_events.updated_at < now() - interval '5 minutes'
    returning id
  )
  select exists(select 1 from upsert) into v_claimed;
  if v_claimed then
    return 'acquis';
  end if;
  select status into v_status from public.stripe_events where id = p_id;
  if v_status = 'traite' then
    return 'traite';
  end if;
  return 'en_cours';
end;
$$;

revoke all on function public.claim_stripe_event(text) from public, anon, authenticated;
grant execute on function public.claim_stripe_event(text) to service_role;
