-- Suite de la contre-vérification (N-1 à N-15).
-- N-1 et N-2 sont dans le même fichier : la propriété du rendez-vous
-- est vérifiée avant Stripe, et le propriétaire ne change plus un rôle sans aal2.

-- N-1
create or replace function public.service_begin_abandon(p_booking uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select p.stripe_payment_intent_id into v_intent
  from public.bookings b
  join public.payments p on p.booking_id = b.id
  where b.id = p_booking
    and b.client_id = p_user
    and b.status = 'en_attente_paiement'
    and p.status <> 'paye'
  for update of b;
  if not found then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0002';
  end if;
  return v_intent;
end;
$$;

revoke all on function public.service_begin_abandon(uuid, uuid) from public, anon, authenticated;
grant execute on function public.service_begin_abandon(uuid, uuid) to service_role;

-- N-2 : le grant et la politique resserrée voyagent ensemble.
grant execute on function public.is_proprietaire() to authenticated;

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- N-4 : file de remboursements, écrite dans la même transaction que l'annulation.
create table if not exists public.refund_jobs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id),
  amount_cents int not null check (amount_cents > 0),
  idempotency_key text not null unique,
  kind text not null,
  status text not null default 'en_attente' check (status in ('en_attente', 'emis', 'echec')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.refund_jobs enable row level security;
revoke all on public.refund_jobs from anon, authenticated;

create table if not exists public.stripe_events (
  id text primary key,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;

create table if not exists public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now()
);
alter table public.deletion_requests enable row level security;
revoke all on public.deletion_requests from anon, authenticated;

create or replace function public.enqueue_refund_job(p_booking uuid, p_amount int, p_key text, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_amount, 0) <= 0 then
    return;
  end if;
  insert into public.refund_jobs (booking_id, amount_cents, idempotency_key, kind)
  values (p_booking, p_amount, p_key, p_kind)
  on conflict (idempotency_key) do nothing;
end;
$$;

create or replace function public.claim_stripe_event(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  insert into public.stripe_events (id) values (p_id) on conflict do nothing;
  return found;
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
    where j.status in ('en_attente', 'echec') and j.attempts < 8
    order by j.created_at
    limit 20
    for update skip locked
  ), updated as (
    update public.refund_jobs j
    set attempts = j.attempts + 1, updated_at = now()
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

create or replace function public.mark_refund_job(p_key text, p_ok boolean, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.refund_jobs
  set status = case when p_ok then 'emis' else 'echec' end,
      last_error = p_error,
      updated_at = now()
  where idempotency_key = p_key;
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
      and j.status in ('en_attente', 'echec')
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
  v_count int;
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
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- N-5 : le cumul Stripe ne réécrit plus le montant décidé en base.
create or replace function public.sync_stripe_refund(p_intent text, p_refunded int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.payments
  set stripe_refund_cents = greatest(stripe_refund_cents, p_refunded),
      status = case
        when greatest(stripe_refund_cents, p_refunded) >= amount_cents then 'rembourse'::public.payment_status
        when greatest(stripe_refund_cents, p_refunded) > 0 then 'rembourse_partiel'::public.payment_status
        else status
      end
  where stripe_payment_intent_id = p_intent;
end;
$$;

-- N-8 : annuler un rendez-vous payé ou honorer une visite exige aal2.
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
     and p_action in ('refund', 'team', 'payments', 'settings', 'promos', 'services', 'cancelClient', 'honor')
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Vérification renforcée requise' using errcode = '42501';
  end if;
end;
$$;

-- N-3
create or replace function public.activate_invited_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.last_sign_in_at is not null and old.last_sign_in_at is distinct from new.last_sign_in_at then
    begin
      update public.profiles
      set active = true, invited_at = null
      where id = new.id and active = false and invited_at is not null;
    exception when unique_violation then
      insert into public.audit_log (action, entity, entity_id, detail)
      values ('activation_bloquee', 'profile', new.id::text, '{}'::jsonb);
    end;
  end if;
  return new;
end;
$$;

create or replace function public.admin_set_active(p_user uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('team');
  if not p_active
     and exists (select 1 from public.profiles where id = p_user and role = 'proprietaire' and active)
     and (select count(*) from public.profiles where role = 'proprietaire' and active and id <> p_user) < 1 then
    raise exception 'Il doit rester au moins un propriétaire actif.';
  end if;
  update public.profiles
  set active = p_active, invited_at = null
  where id = p_user;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), case when p_active then 'reactivation' else 'desactivation' end, 'profile', p_user::text, '{}'::jsonb);
end;
$$;

-- N-6 : l'annulation client relit le réglage sur place, et pose un job de remboursement.
create or replace function public.cancel_booking(p_booking uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  p public.payments%rowtype;
  v_within boolean;
  v_paid boolean;
  v_stripe boolean;
  v_fee_dollars numeric;
  v_fee int := 0;
  v_gst numeric := 0;
  v_qst numeric := 0;
  v_refund int := 0;
  v_gst_number text;
  v_qst_number text;
  v_policy text;
  v_owing int := 0;
begin
  select * into b from public.bookings where id = p_booking and client_id = auth.uid() for update;
  if not found then
    raise exception 'Rendez-vous introuvable.';
  end if;
  select * into p from public.payments where booking_id = b.id for update;
  if b.status in ('annule', 'annule_tardif') then
    raise exception 'Ce rendez-vous est déjà annulé.';
  end if;
  if b.status = 'honore' or b.starts_at <= now() then
    raise exception 'Ce rendez-vous ne peut plus être annulé.';
  end if;
  v_within := b.starts_at - now() < interval '24 hours';
  v_paid := b.payment_method = 'en_ligne' and p.status = 'paye';
  v_stripe := p.stripe_payment_intent_id is not null;
  select onsite_late_policy, gst_number, qst_number into v_policy, v_gst_number, v_qst_number from public.salon_settings where id = 1;
  perform public.release_promo(b.id);
  if v_within and v_paid then
    v_fee_dollars := round((b.price_cents::numeric / 100) * 0.5, 2);
    v_fee := (v_fee_dollars * 100)::int;
    v_gst := round(round(v_fee_dollars * 100 / 105, 2) * 0.05, 2);
    v_qst := round(round(v_fee_dollars * 100 / 109.975, 2) * 0.09975, 2);
    v_refund := b.total_cents - v_fee;
    update public.bookings
    set status = 'annule_tardif', cancelled_at = now(), loyalty_redeemed = false
    where id = b.id;
    update public.payments
    set status = case when v_stripe then 'remboursement_en_cours'::public.payment_status else 'rembourse_partiel'::public.payment_status end,
        refunded_cents = v_refund,
        fee_cents = v_fee,
        fee_gst_cents = (v_gst * 100)::int,
        fee_qst_cents = (v_qst * 100)::int,
        fee_ht_cents = v_fee - (v_gst * 100)::int - (v_qst * 100)::int
    where booking_id = b.id;
  else
    if v_within and b.payment_method = 'sur_place' and v_policy = 'a_la_prochaine' then
      v_fee_dollars := round((b.price_cents::numeric / 100) * 0.5, 2);
      v_owing := (v_fee_dollars * 100)::int;
    end if;
    v_refund := case when not v_within and v_paid then b.total_cents else 0 end;
    update public.bookings
    set status = 'annule', cancelled_at = now(), loyalty_redeemed = false, fee_owing_cents = v_owing
    where id = b.id;
    update public.payments
    set status = case
          when v_paid and v_stripe then 'remboursement_en_cours'::public.payment_status
          when v_paid then 'rembourse'::public.payment_status
          else 'echoue'::public.payment_status
        end,
        refunded_cents = v_refund,
        fee_cents = 0
    where booking_id = b.id;
  end if;
  if v_stripe and v_refund > 0 then
    perform public.enqueue_refund_job(b.id, v_refund, 'refund-' || b.id::text || '-cancel', 'cancel');
  end if;
  if b.loyalty_redeemed then
    update public.loyalty_accounts set rewards_available = rewards_available + 1 where client_id = auth.uid();
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (
    auth.uid(),
    'cancellation',
    'booking',
    b.id::text,
    jsonb_build_object(
      'within24h', v_within,
      'feeCents', v_fee,
      'owingCents', v_owing,
      'refundCents', v_refund,
      'stripe', v_stripe,
      'gstNumber', v_gst_number,
      'qstNumber', v_qst_number
    )
  );
  return b.id;
end;
$$;

create or replace function public.admin_cancel(p_booking uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  p public.payments%rowtype;
  v_within boolean;
  v_paid boolean;
  v_stripe boolean;
  v_fee_dollars numeric;
  v_fee int := 0;
  v_gst numeric := 0;
  v_qst numeric := 0;
  v_refund int := 0;
  v_policy text;
  v_owing int := 0;
begin
  perform public.assert_staff('cancelClient');
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'Rendez-vous introuvable.';
  end if;
  select * into p from public.payments where booking_id = b.id for update;
  if b.status in ('annule', 'annule_tardif') then
    raise exception 'Ce rendez-vous est déjà annulé.';
  end if;
  if b.status = 'honore' or b.starts_at <= now() then
    raise exception 'Ce rendez-vous ne peut plus être annulé.';
  end if;
  v_within := b.starts_at - now() < interval '24 hours';
  v_paid := b.payment_method = 'en_ligne' and p.status = 'paye';
  v_stripe := p.stripe_payment_intent_id is not null;
  select onsite_late_policy into v_policy from public.salon_settings where id = 1;
  perform public.release_promo(b.id);
  if v_within and v_paid then
    v_fee_dollars := round((b.price_cents::numeric / 100) * 0.5, 2);
    v_fee := (v_fee_dollars * 100)::int;
    v_gst := round(round(v_fee_dollars * 100 / 105, 2) * 0.05, 2);
    v_qst := round(round(v_fee_dollars * 100 / 109.975, 2) * 0.09975, 2);
    v_refund := b.total_cents - v_fee;
    update public.bookings set status = 'annule_tardif', cancelled_at = now(), loyalty_redeemed = false where id = b.id;
    update public.payments
    set status = case when v_stripe then 'remboursement_en_cours'::public.payment_status else 'rembourse_partiel'::public.payment_status end,
        refunded_cents = v_refund, fee_cents = v_fee,
        fee_gst_cents = (v_gst * 100)::int, fee_qst_cents = (v_qst * 100)::int,
        fee_ht_cents = v_fee - (v_gst * 100)::int - (v_qst * 100)::int
    where booking_id = b.id;
  else
    if v_within and b.payment_method = 'sur_place' and v_policy = 'a_la_prochaine' then
      v_fee_dollars := round((b.price_cents::numeric / 100) * 0.5, 2);
      v_owing := (v_fee_dollars * 100)::int;
    end if;
    v_refund := case when not v_within and v_paid then b.total_cents else 0 end;
    update public.bookings
    set status = 'annule', cancelled_at = now(), loyalty_redeemed = false, fee_owing_cents = v_owing
    where id = b.id;
    update public.payments
    set status = case
          when v_paid and v_stripe then 'remboursement_en_cours'::public.payment_status
          when v_paid then 'rembourse'::public.payment_status
          else 'echoue'::public.payment_status
        end,
        refunded_cents = v_refund, fee_cents = 0
    where booking_id = b.id;
  end if;
  if v_stripe and v_refund > 0 then
    perform public.enqueue_refund_job(b.id, v_refund, 'refund-' || b.id::text || '-cancel', 'cancel');
  end if;
  if b.loyalty_redeemed and b.client_id is not null then
    update public.loyalty_accounts set rewards_available = rewards_available + 1 where client_id = b.client_id;
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'annulation', 'booking', b.id::text, jsonb_build_object('feeCents', v_fee, 'owingCents', v_owing, 'refundCents', v_refund, 'stripe', v_stripe, 'client', b.client_name));
end;
$$;

create or replace function public.admin_refund_fee(p_booking uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee int;
  v_name text;
  v_intent text;
begin
  perform public.assert_staff('refund');
  select fee_cents, stripe_payment_intent_id, (select client_name from public.bookings where id = p_booking)
  into v_fee, v_intent, v_name
  from public.payments where booking_id = p_booking;
  if coalesce(v_fee, 0) <= 0 then
    raise exception 'Aucun frais à rembourser.';
  end if;
  update public.payments
  set refunded_cents = refunded_cents + fee_cents,
      fee_cents = 0,
      fee_gst_cents = 0,
      fee_qst_cents = 0,
      fee_ht_cents = 0,
      status = case
        when v_intent is not null then 'remboursement_en_cours'::public.payment_status
        else 'rembourse'::public.payment_status
      end
  where booking_id = p_booking;
  if v_intent is not null then
    perform public.enqueue_refund_job(p_booking, v_fee, 'refund-' || p_booking::text || '-fee', 'fee');
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'remboursement_frais', 'booking', p_booking::text, jsonb_build_object('feeCents', v_fee, 'client', v_name, 'stripe', v_intent is not null));
end;
$$;

-- N-10 : une tentative refusée reste enregistrée.
create or replace function public.validate_promo(p_code text, p_date date, p_subtotal int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  promo public.promo_codes%rowtype;
  v_discount int;
begin
  if auth.uid() is null then
    raise exception 'Connecte-toi pour continuer.';
  end if;
  insert into public.promo_attempts (user_id) values (auth.uid());
  if (select count(*) from public.promo_attempts where user_id = auth.uid() and attempted_at > now() - interval '1 hour') > 30 then
    return jsonb_build_object('ok', false, 'error', 'Trop de tentatives. Réessaie plus tard.');
  end if;
  select * into promo from public.promo_codes where upper(code) = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Ce code n’est pas reconnu.');
  end if;
  if p_date < promo.starts_on or p_date > promo.ends_on then
    return jsonb_build_object('ok', false, 'error', 'Ce code n’est pas valable à cette date.');
  end if;
  if promo.usage_limit is not null and promo.usage_count >= promo.usage_limit then
    return jsonb_build_object('ok', false, 'error', 'Ce code a atteint sa limite.');
  end if;
  if promo.discount_type = 'percent' then
    v_discount := round(p_subtotal * promo.value / 100.0);
  else
    v_discount := least((promo.value * 100)::int, p_subtotal);
  end if;
  if v_discount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Ce code ne change pas le montant.');
  end if;
  return jsonb_build_object('ok', true, 'code', promo.code, 'discountCents', v_discount);
end;
$$;

create or replace function public.apply_promo(p_booking uuid, p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  v_quote jsonb;
  v_discount int;
  v_net int;
  v_tax record;
begin
  if auth.uid() is null then
    raise exception 'Connecte-toi pour continuer.';
  end if;
  select * into b from public.bookings where id = p_booking and client_id = auth.uid() for update;
  if not found or b.status <> 'en_attente_paiement' or b.promo_code is not null then
    raise exception 'Ce code ne peut pas être appliqué.';
  end if;
  if exists (select 1 from public.payments where booking_id = b.id and stripe_payment_intent_id is not null) then
    raise exception 'Annule le paiement en cours avant d’appliquer un code.';
  end if;
  if exists (select 1 from public.promo_redemptions where client_id = auth.uid() and code = upper(trim(p_code))) then
    raise exception 'Tu as déjà utilisé ce code.';
  end if;
  perform 1 from public.promo_codes where upper(code) = upper(trim(p_code)) for update;
  v_quote := public.validate_promo(p_code, (b.starts_at at time zone 'America/Toronto')::date, b.price_cents + b.discount_cents);
  if coalesce((v_quote->>'ok')::boolean, false) is not true then
    raise exception '%', coalesce(v_quote->>'error', 'Ce code n’est pas reconnu.');
  end if;
  v_discount := (v_quote->>'discountCents')::int;
  v_net := greatest(0, b.price_cents + b.discount_cents - v_discount);
  select * into v_tax from public.line_taxes(v_net);
  update public.bookings
  set price_cents = v_net, discount_cents = v_discount, promo_code = v_quote->>'code',
      gst_cents = v_tax.gst_cents, qst_cents = v_tax.qst_cents, total_cents = v_tax.total_cents
  where id = b.id;
  update public.payments set amount_cents = v_tax.total_cents where booking_id = b.id;
  insert into public.promo_redemptions (booking_id, client_id, code) values (b.id, auth.uid(), v_quote->>'code');
  update public.promo_codes set usage_count = usage_count + 1 where code = v_quote->>'code';
  return b.id;
end;
$$;

drop function if exists public.create_booking(uuid, uuid, date, int, public.payment_method, boolean);

create function public.create_booking(
  p_service_id uuid,
  p_barber_id uuid,
  p_date date,
  p_start_minute int,
  p_method public.payment_method,
  p_redeem boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_duration int;
  v_price int;
  v_occupancy int;
  v_dow int;
  v_starts timestamptz;
  v_gst int;
  v_qst int;
  v_total int;
  v_id uuid := gen_random_uuid();
  v_rewards int;
begin
  if v_user is null then
    raise exception 'Connecte-toi pour continuer.';
  end if;
  insert into public.booking_attempts (user_id) values (v_user);
  if not exists (select 1 from public.profiles where id = v_user and active) then
    return jsonb_build_object('ok', false, 'error', 'Profil inactif');
  end if;
  if (select email_confirmed_at from auth.users where id = v_user) is null then
    return jsonb_build_object('ok', false, 'error', 'Confirme ton courriel avant de réserver.');
  end if;
  if (select count(*) from public.booking_attempts where user_id = v_user and created_at > now() - interval '1 hour') > 8 then
    return jsonb_build_object('ok', false, 'error', 'Trop de réservations. Réessaie dans une heure.');
  end if;
  if (
    select count(*) from public.bookings
    where client_id = v_user and starts_at > now() and status in ('en_attente_paiement', 'confirme')
  ) >= 3 then
    return jsonb_build_object('ok', false, 'error', 'Tu as déjà trois rendez-vous à venir.');
  end if;
  perform 1 from public.barbers where id = p_barber_id for update;
  select full_name into v_name from public.profiles where id = v_user;
  select duration_minutes, price_cents into v_duration, v_price
  from public.services where id = p_service_id and active;
  if v_duration is null then
    return jsonb_build_object('ok', false, 'error', 'Prestation introuvable.');
  end if;
  if not exists (
    select 1 from public.barber_services where barber_id = p_barber_id and service_id = p_service_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'Ce coiffeur ne fait pas cette prestation.');
  end if;
  v_dow := extract(dow from p_date)::int;
  v_occupancy := public.occupancy_minutes(v_duration);
  if v_dow < 2 or v_dow > 6 or p_start_minute < 540 or p_start_minute % 15 <> 0 or p_start_minute + v_occupancy > 1140 then
    return jsonb_build_object('ok', false, 'error', 'Créneau invalide.');
  end if;
  v_starts := (p_date::timestamp + make_interval(mins => p_start_minute)) at time zone 'America/Toronto';
  if v_starts <= now() then
    return jsonb_build_object('ok', false, 'error', 'Ce créneau est déjà passé.');
  end if;
  if exists (
    select 1 from public.bookings bk
    where bk.barber_id = p_barber_id
      and bk.status in ('en_attente_paiement', 'confirme', 'honore')
      and tstzrange(bk.starts_at, bk.starts_at + make_interval(mins => public.occupancy_minutes(bk.duration_minutes)), '[)')
        && tstzrange(v_starts, v_starts + make_interval(mins => v_occupancy), '[)')
  ) or exists (
    select 1 from public.blocked_slots s
    where s.barber_id = p_barber_id
      and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(v_starts, v_starts + make_interval(mins => v_occupancy), '[)')
  ) then
    return jsonb_build_object('ok', false, 'error', 'Ce créneau n’est plus libre.');
  end if;
  if p_redeem then
    select rewards_available into v_rewards from public.loyalty_accounts where client_id = v_user for update;
    if coalesce(v_rewards, 0) < 1 then
      return jsonb_build_object('ok', false, 'error', 'Aucune coupe offerte à utiliser.');
    end if;
    update public.loyalty_accounts set rewards_available = rewards_available - 1 where client_id = v_user;
    v_price := 0;
  end if;
  select gst_cents, qst_cents, total_cents into v_gst, v_qst, v_total from public.line_taxes(v_price);
  insert into public.bookings (
    id, client_id, client_name, barber_id, service_id, starts_at, ends_at, duration_minutes,
    price_cents, gst_cents, qst_cents, total_cents, payment_method, status, loyalty_redeemed
  ) values (
    v_id, v_user, v_name, p_barber_id, p_service_id, v_starts, v_starts + make_interval(mins => v_duration), v_duration,
    v_price, v_gst, v_qst, v_total, p_method,
    case when p_method = 'en_ligne' then 'en_attente_paiement' else 'confirme' end,
    p_redeem
  );
  insert into public.payments (booking_id, method, status, amount_cents)
  values (
    v_id,
    p_method,
    case when p_method = 'en_ligne' then 'en_attente' else 'a_encaisser' end,
    v_total
  );
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- N-11
create or replace function public.prepare_account_deletion(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row record;
  v_jobs jsonb := '[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'proprietaire' and active)
     and (select count(*) from public.profiles where role = 'proprietaire' and active and id <> p_user) < 1 then
    raise exception 'Il doit rester au moins un propriétaire actif.';
  end if;
  for row in
    select b.id, b.loyalty_redeemed, p.stripe_payment_intent_id, p.amount_cents, p.status as pay_status, b.status
    from public.bookings b
    join public.payments p on p.booking_id = b.id
    where b.client_id = p_user
      and b.starts_at > now()
      and b.status in ('en_attente_paiement', 'confirme')
    for update of b
  loop
    perform public.release_promo(row.id);
    if row.loyalty_redeemed then
      update public.loyalty_accounts set rewards_available = rewards_available + 1 where client_id = p_user;
    end if;
    update public.bookings set status = 'annule', cancelled_at = now(), loyalty_redeemed = false where id = row.id;
    if row.pay_status = 'paye' and row.stripe_payment_intent_id is not null then
      update public.payments
      set status = 'remboursement_en_cours', refunded_cents = amount_cents, fee_cents = 0
      where booking_id = row.id;
      perform public.enqueue_refund_job(row.id, row.amount_cents, 'refund-' || row.id::text || '-delete', 'delete');
      v_jobs := v_jobs || jsonb_build_array(jsonb_build_object(
        'bookingId', row.id,
        'intentId', row.stripe_payment_intent_id,
        'amount', row.amount_cents
      ));
    else
      update public.payments set status = 'echoue', refunded_cents = 0 where booking_id = row.id and status <> 'paye';
    end if;
  end loop;
  return v_jobs;
end;
$$;

create or replace function public.anonymize_client(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'proprietaire' and active)
     and (select count(*) from public.profiles where role = 'proprietaire' and active and id <> p_user) < 1 then
    raise exception 'Il doit rester au moins un propriétaire actif.';
  end if;
  select email into v_email from auth.users where id = p_user;
  update public.audit_log
  set detail = '{"redacted": true}'::jsonb
  where actor_id = p_user
     or entity_id = p_user::text
     or (v_email is not null and (entity_id = v_email or detail->>'email' = v_email));
  update public.bookings set client_id = null, client_name = 'Client supprimé' where client_id = p_user;
  update public.reviews set client_id = null, client_name = 'Client' where client_id = p_user;
  update public.audit_log set actor_id = null where actor_id = p_user;
  update public.blocked_slots set created_by = null where created_by = p_user;
  delete from public.client_notes where client_key = 'user:' || p_user::text or client_key = p_user::text;
  delete from public.notification_jobs where user_id = p_user;
  delete from public.push_tokens where user_id = p_user;
  delete from public.loyalty_accounts where client_id = p_user;
  delete from public.promo_attempts where user_id = p_user;
  delete from public.booking_attempts where user_id = p_user;
end;
$$;

-- N-15 : pg_cron (rôle postgres) peut purger. L'abandon d'un panier ne dit pas « annulé ».
create or replace function public.purge_client_notes()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  delete from public.client_notes where updated_at < now() - interval '24 months';
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
      v_result := v_result || jsonb_build_array(jsonb_build_object('bookingId', row.id, 'intentId', row.stripe_payment_intent_id));
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function public.trg_booking_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status and new.status in ('annule', 'annule_tardif') then
    update public.notification_jobs set status = 'annule'
    where booking_id = new.id and kind like 'rappel%' and status = 'planifie';
    if coalesce(current_setting('nanometre.skip_cancel_notice', true), '') is distinct from '1' then
      perform public.enqueue_booking_notifications(new.id, 'annulation', 'Rendez-vous annulé', 'Ton rendez-vous a été annulé.');
    end if;
  elsif (tg_op = 'INSERT' and new.status = 'confirme')
     or (tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'confirme') then
    perform public.enqueue_booking_notifications(new.id, 'confirmation', 'C’est réservé', 'Ton rendez-vous est confirmé.');
    perform public.enqueue_booking_notifications(new.id, 'rappel_24h', 'Demain au salon', 'Rappel : ton rendez-vous est demain.');
    perform public.enqueue_booking_notifications(new.id, 'rappel_2h', 'Dans deux heures', 'Ton rendez-vous approche.');
  elsif tg_op = 'UPDATE' and old.starts_at is distinct from new.starts_at and new.status = 'confirme' then
    update public.notification_jobs set status = 'annule'
    where booking_id = new.id and kind like 'rappel%' and status = 'planifie';
    perform public.enqueue_booking_notifications(new.id, 'changement', 'Rendez-vous déplacé', 'Ton rendez-vous a été déplacé.');
    perform public.enqueue_booking_notifications(new.id, 'rappel_24h', 'Demain au salon', 'Rappel : ton rendez-vous est demain.');
    perform public.enqueue_booking_notifications(new.id, 'rappel_2h', 'Dans deux heures', 'Ton rendez-vous approche.');
  end if;
  return new;
end;
$$;

-- N-11 : demande de suppression sans réinstaller l'application.
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
  insert into public.deletion_requests (email) values (v_email);
end;
$$;

-- N-7 : le privilège PUBLIC global, pas seulement celui du schéma.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname not in ('salon_public', 'visible_barbers', 'visible_services', 'visible_reviews', 'list_slots')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

grant execute on function public.salon_public() to anon, authenticated;
grant execute on function public.visible_barbers() to anon, authenticated;
grant execute on function public.visible_services() to anon, authenticated;
grant execute on function public.visible_reviews(uuid) to anon, authenticated;
grant execute on function public.list_slots(uuid, date, uuid) to anon, authenticated;
grant execute on function public.request_account_deletion(text) to anon, authenticated;

grant execute on function public.my_bookings() to authenticated;
grant execute on function public.my_loyalty() to authenticated;
grant execute on function public.booking_json(uuid) to authenticated;
grant execute on function public.create_booking(uuid, uuid, date, int, public.payment_method, boolean) to authenticated;
grant execute on function public.confirm_on_site(uuid) to authenticated;
grant execute on function public.abandon_checkout(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.submit_review(uuid, int, text) to authenticated;
grant execute on function public.validate_promo(text, date, int) to authenticated;
grant execute on function public.apply_promo(uuid, text) to authenticated;
grant execute on function public.set_notification_opt_in(boolean) to authenticated;
grant execute on function public.notification_opt_in() to authenticated;
grant execute on function public.my_notifications() to authenticated;
grant execute on function public.set_push_token(text) to authenticated;
grant execute on function public.clear_my_push_tokens() to authenticated;
grant execute on function public.is_proprietaire() to authenticated;
grant execute on function public.admin_dashboard(date, text) to authenticated;
grant execute on function public.admin_day(date) to authenticated;
grant execute on function public.admin_agenda(date, uuid) to authenticated;
grant execute on function public.admin_block(uuid, date, int, int, text) to authenticated;
grant execute on function public.admin_unblock(uuid) to authenticated;
grant execute on function public.admin_honor(uuid) to authenticated;
grant execute on function public.admin_move(uuid, date, int) to authenticated;
grant execute on function public.admin_cancel(uuid) to authenticated;
grant execute on function public.admin_payments(date, date) to authenticated;
grant execute on function public.admin_refund_fee(uuid) to authenticated;
grant execute on function public.admin_clients() to authenticated;
grant execute on function public.admin_save_note(text, text) to authenticated;
grant execute on function public.admin_reviews() to authenticated;
grant execute on function public.admin_moderate_review(uuid, public.review_status) to authenticated;
grant execute on function public.admin_promos() to authenticated;
grant execute on function public.admin_save_promo(jsonb) to authenticated;
grant execute on function public.admin_team() to authenticated;
grant execute on function public.admin_set_role(uuid, public.user_role) to authenticated;
grant execute on function public.admin_set_active(uuid, boolean) to authenticated;
grant execute on function public.admin_invite(text, text, public.user_role, uuid) to authenticated;
grant execute on function public.admin_update_salon(int, int, text) to authenticated;
grant execute on function public.admin_update_service(uuid, int) to authenticated;
grant execute on function public.admin_set_weekday(uuid, int, boolean) to authenticated;
grant execute on function public.admin_audit() to authenticated;
grant execute on function public.admin_barber_setup() to authenticated;
grant execute on function public.admin_set_service(uuid, uuid, boolean) to authenticated;

grant execute on function public.confirm_online_payment(uuid, text, int, text) to service_role;
grant execute on function public.sync_stripe_refund(text, int) to service_role;
grant execute on function public.service_finish_abandon(uuid, uuid, boolean) to service_role;
grant execute on function public.service_begin_abandon(uuid, uuid) to service_role;
grant execute on function public.expire_stale_checkouts() to service_role;
grant execute on function public.prepare_account_deletion(uuid) to service_role;
grant execute on function public.anonymize_client(uuid) to service_role;
grant execute on function public.purge_client_notes() to service_role;
grant execute on function public.enqueue_refund_job(uuid, int, text, text) to service_role;
grant execute on function public.claim_stripe_event(text) to service_role;
grant execute on function public.claim_refund_jobs() to service_role;
grant execute on function public.mark_refund_job(text, boolean, text) to service_role;
grant execute on function public.pending_refund_jobs(uuid) to service_role;
grant execute on function public.alert_stale_refunds() to service_role;
