-- Préparation de la mise en scène : reprise des webhooks, files rejouables,
-- plafond des demandes de suppression, aal2, et privilèges par défaut des tables.

alter table public.stripe_events add column status text;
alter table public.stripe_events add column updated_at timestamptz;
update public.stripe_events set status = 'traite', updated_at = received_at where status is null;
alter table public.stripe_events alter column status set default 'en_cours';
alter table public.stripe_events alter column status set not null;
alter table public.stripe_events alter column updated_at set default now();
alter table public.stripe_events alter column updated_at set not null;

alter table public.refund_jobs drop constraint if exists refund_jobs_status_check;
alter table public.refund_jobs add constraint refund_jobs_status_check
  check (status in ('en_attente', 'en_cours', 'emis', 'echec'));
alter table public.refund_jobs add column if not exists leased_until timestamptz;

alter table public.salon_settings
  add column if not exists tax_numbers_placeholder boolean not null default true;

create table if not exists public.stripe_intent_jobs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id),
  intent_id text not null,
  status text not null default 'en_attente' check (status in ('en_attente', 'en_cours', 'fait', 'echec')),
  attempts int not null default 0,
  leased_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, intent_id)
);
alter table public.stripe_intent_jobs enable row level security;
revoke all on public.stripe_intent_jobs from anon, authenticated;

-- Un événement n'est retenu qu'en cours de traitement. Un échec l'efface.
-- Un traitement planté depuis plus de cinq minutes peut être repris.
create or replace function public.claim_stripe_event(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
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
  return v_claimed;
end;
$$;

create or replace function public.finish_stripe_event(p_id text, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_ok then
    update public.stripe_events set status = 'traite', updated_at = now() where id = p_id and status = 'en_cours';
  else
    delete from public.stripe_events where id = p_id and status = 'en_cours';
  end if;
end;
$$;

create or replace function public.claim_refund_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jobs jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  with picked as (
    select j.id
    from public.refund_jobs j
    where j.attempts < 8
      and (
        j.status in ('en_attente', 'echec')
        or (j.status = 'en_cours' and j.leased_until < now())
      )
    order by j.created_at
    limit 20
    for update skip locked
  ), updated as (
    update public.refund_jobs j
    set attempts = j.attempts + 1,
        status = 'en_cours',
        leased_until = now() + interval '5 minutes',
        updated_at = now()
    from picked
    where j.id = picked.id
    returning j.booking_id, j.amount_cents, j.idempotency_key, j.kind
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'bookingId', u.booking_id,
    'amount', u.amount_cents,
    'key', u.idempotency_key,
    'kind', u.kind,
    'intentId', p.stripe_payment_intent_id
  )), '[]'::jsonb)
  into v_jobs
  from updated u
  join public.payments p on p.booking_id = u.booking_id;
  return v_jobs;
end;
$$;

create or replace function public.claim_refund_job(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  with updated as (
    update public.refund_jobs j
    set attempts = j.attempts + 1,
        status = 'en_cours',
        leased_until = now() + interval '5 minutes',
        updated_at = now()
    where j.idempotency_key = p_key
      and j.attempts < 8
      and (
        j.status in ('en_attente', 'echec')
        or (j.status = 'en_cours' and j.leased_until < now())
      )
    returning j.booking_id, j.amount_cents, j.idempotency_key, j.kind
  )
  select jsonb_build_object(
    'bookingId', u.booking_id,
    'amount', u.amount_cents,
    'key', u.idempotency_key,
    'kind', u.kind,
    'intentId', p.stripe_payment_intent_id
  )
  into v_job
  from updated u
  join public.payments p on p.booking_id = u.booking_id;
  return v_job;
end;
$$;

create or replace function public.mark_refund_job(p_key text, p_ok boolean, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking uuid;
  v_sent int;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.refund_jobs
  set status = case when p_ok then 'emis' else 'echec' end,
      last_error = p_error,
      leased_until = null,
      updated_at = now()
  where idempotency_key = p_key
  returning booking_id into v_booking;
  if p_ok and v_booking is not null then
    select coalesce(sum(amount_cents), 0) into v_sent
    from public.refund_jobs
    where booking_id = v_booking and status = 'emis';
    update public.payments
    set stripe_refund_cents = greatest(stripe_refund_cents, v_sent)
    where booking_id = v_booking;
  end if;
end;
$$;

create or replace function public.pending_refund_jobs(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'bookingId', j.booking_id,
      'intentId', p.stripe_payment_intent_id,
      'amount', j.amount_cents,
      'key', j.idempotency_key,
      'kind', j.kind
    ))
    from public.refund_jobs j
    join public.bookings b on b.id = j.booking_id
    join public.payments p on p.booking_id = b.id
    where b.client_id = p_user
      and j.status in ('en_attente', 'en_cours', 'echec')
      and p.stripe_payment_intent_id is not null
  ), '[]'::jsonb);
end;
$$;

create or replace function public.alert_stale_refunds()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_audit int := 0;
begin
  if auth.role() is distinct from 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  insert into public.audit_log (action, entity, entity_id, detail)
  select 'remboursement_en_retard', 'payment', p.booking_id::text,
         jsonb_build_object('refunded', p.refunded_cents, 'stripe', p.stripe_refund_cents)
  from public.payments p
  join public.bookings b on b.id = p.booking_id
  where p.status = 'remboursement_en_cours'
    and p.refunded_cents > p.stripe_refund_cents
    and b.cancelled_at < now() - interval '15 minutes'
    and not exists (
      select 1 from public.audit_log a
      where a.action = 'remboursement_en_retard'
        and a.entity_id = p.booking_id::text
        and a.created_at > now() - interval '1 hour'
    );
  get diagnostics v_audit = row_count;
  v_count := v_audit;
  insert into public.audit_log (action, entity, entity_id, detail)
  select 'remboursement_echec', 'refund_job', j.id::text,
         jsonb_build_object('bookingId', j.booking_id, 'attempts', j.attempts, 'error', j.last_error)
  from public.refund_jobs j
  where j.status = 'echec' and j.attempts >= 8
    and not exists (
      select 1 from public.audit_log a
      where a.action = 'remboursement_echec'
        and a.entity_id = j.id::text
        and a.created_at > now() - interval '1 hour'
    );
  get diagnostics v_audit = row_count;
  v_count := v_count + v_audit;
  insert into public.notification_jobs (user_id, kind, title, body, path, send_at)
  select owner.id, 'remboursement_bloque', 'Remboursement bloqué',
         'Un remboursement n’aboutit pas. Ouvre les paiements du salon.',
         '/admin', now()
  from public.profiles owner
  where owner.role = 'proprietaire' and owner.active
    and (
      exists (
        select 1 from public.payments p
        join public.bookings b on b.id = p.booking_id
        where p.status = 'remboursement_en_cours'
          and p.refunded_cents > p.stripe_refund_cents
          and b.cancelled_at < now() - interval '15 minutes'
      )
      or exists (
        select 1 from public.refund_jobs j where j.status = 'echec' and j.attempts >= 8
      )
    )
    and not exists (
      select 1 from public.notification_jobs n
      where n.user_id = owner.id
        and n.kind = 'remboursement_bloque'
        and n.send_at > now() - interval '1 hour'
    );
  return v_count;
end;
$$;

-- Lecture du chiffre, des clients, des déplacements, des chaises, des blocages et de la modération : aal2.
create or replace function public.assert_staff(p_action text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_role();
begin
  if v_role is null or v_role = 'client' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if v_role = 'coiffeur' and p_action not in ('day', 'agenda', 'block', 'clients', 'reviewsRead', 'honor') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if v_role = 'proprietaire'
     and p_action in (
       'refund', 'team', 'payments', 'settings', 'promos', 'services', 'cancelClient', 'honor',
       'dashboard', 'clients', 'move', 'barbers', 'block', 'reviewsModerate'
     )
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Vérification renforcée requise' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.expire_stale_checkouts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row record;
  v_result jsonb := '[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  perform set_config('nanometre.skip_cancel_notice', '1', true);
  for row in
    select b.id, b.loyalty_redeemed, b.client_id, p.stripe_payment_intent_id
    from public.bookings b
    join public.payments p on p.booking_id = b.id
    where b.status = 'en_attente_paiement' and b.created_at < now() - interval '15 minutes'
    for update of b
  loop
    perform public.release_promo(row.id);
    if row.loyalty_redeemed and row.client_id is not null then
      update public.loyalty_accounts set rewards_available = rewards_available + 1 where client_id = row.client_id;
    end if;
    update public.bookings set status = 'annule', cancelled_at = now(), loyalty_redeemed = false where id = row.id;
    update public.payments set status = 'echoue' where booking_id = row.id and status = 'en_attente';
    if row.stripe_payment_intent_id is not null then
      insert into public.stripe_intent_jobs (booking_id, intent_id)
      values (row.id, row.stripe_payment_intent_id)
      on conflict (booking_id, intent_id) do nothing;
      v_result := v_result || jsonb_build_array(jsonb_build_object('bookingId', row.id, 'intentId', row.stripe_payment_intent_id));
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function public.claim_intent_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jobs jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  with picked as (
    select j.id
    from public.stripe_intent_jobs j
    where j.attempts < 8
      and (
        j.status in ('en_attente', 'echec')
        or (j.status = 'en_cours' and j.leased_until < now())
      )
    order by j.created_at
    limit 20
    for update skip locked
  ), updated as (
    update public.stripe_intent_jobs j
    set attempts = j.attempts + 1,
        status = 'en_cours',
        leased_until = now() + interval '5 minutes',
        updated_at = now()
    from picked
    where j.id = picked.id
    returning j.booking_id, j.intent_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('bookingId', booking_id, 'intentId', intent_id)), '[]'::jsonb)
  into v_jobs
  from updated;
  return v_jobs;
end;
$$;

create or replace function public.mark_intent_job(p_booking uuid, p_intent text, p_ok boolean, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.stripe_intent_jobs
  set status = case when p_ok then 'fait' else 'echec' end,
      last_error = p_error,
      leased_until = null,
      updated_at = now()
  where booking_id = p_booking and intent_id = p_intent;
end;
$$;

create or replace function public.salon_public()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_array(jsonb_build_object(
    'name', name,
    'tagline', tagline,
    'address', address,
    'city', city,
    'timezone', timezone,
    'openMinute', open_minute,
    'closeMinute', close_minute,
    'gstNumber', gst_number,
    'qstNumber', qst_number,
    'taxNumbersPlaceholder', tax_numbers_placeholder,
    'phone', phone,
    'onsiteLatePolicy', onsite_late_policy
  ))
  from public.salon_settings
  where id = 1
$$;

-- Plafond global, trace, et avis au propriétaire (Loi 25 : 30 jours pour répondre).
create or replace function public.request_account_deletion(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Courriel invalide.';
  end if;
  if (select count(*) from public.deletion_requests where email = v_email and created_at > now() - interval '1 day') >= 3 then
    return;
  end if;
  if (select count(*) from public.deletion_requests where created_at > now() - interval '1 hour') >= 20 then
    return;
  end if;
  insert into public.deletion_requests (email) values (v_email);
  insert into public.audit_log (action, entity, entity_id, detail)
  values ('demande_suppression', 'profile', v_email, jsonb_build_object('email', v_email));
  insert into public.notification_jobs (user_id, kind, title, body, path, send_at)
  select p.id, 'suppression_compte', 'Demande de suppression',
         'Une personne a demandé la suppression du compte ' || v_email || '. Réponds dans les 30 jours.',
         '/admin', now()
  from public.profiles p
  where p.role = 'proprietaire' and p.active;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    execute format('revoke all on public.%I from anon, authenticated', r.relname);
  end loop;
end $$;

-- Les nouvelles tables ne sont plus ouvertes à anon par défaut.
alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;

do $$
begin
  if current_user is distinct from 'postgres' then
    execute format(
      'alter default privileges for role %I in schema public revoke all on tables from public, anon, authenticated',
      current_user
    );
  end if;
end $$;

revoke all on function public.finish_stripe_event(text, boolean) from public, anon, authenticated;
revoke all on function public.claim_refund_job(text) from public, anon, authenticated;
revoke all on function public.claim_intent_jobs() from public, anon, authenticated;
revoke all on function public.mark_intent_job(uuid, text, boolean, text) from public, anon, authenticated;

grant execute on function public.finish_stripe_event(text, boolean) to service_role;
grant execute on function public.claim_refund_job(text) to service_role;
grant execute on function public.claim_intent_jobs() to service_role;
grant execute on function public.mark_intent_job(uuid, text, boolean, text) to service_role;
grant execute on function public.salon_public() to anon, authenticated;
