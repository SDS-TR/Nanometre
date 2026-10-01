-- Durcissement : paiements, notifications, périmètre, promos, suppression de compte.
-- Les fonctions security definer nouvelles ne sont pas exécutables par anon ni authenticated.

alter table public.payments
  add column if not exists stripe_refund_cents int not null default 0;

alter table public.profiles
  add column if not exists invited_at timestamptz;

alter table public.client_notes
  add column if not exists updated_at timestamptz not null default now();

comment on table public.client_notes is
  'Notes d''équipe. Conservation 24 mois (purge_client_notes), puis destruction. Les pièces fiscales restent dans payments.';

alter table public.profiles drop constraint if exists coiffeur_requires_barber;
alter table public.profiles
  add constraint coiffeur_requires_barber check (role <> 'coiffeur' or barber_id is not null);

create unique index if not exists profiles_one_active_account_per_barber
  on public.profiles (barber_id) where active and barber_id is not null;

create table if not exists public.promo_redemptions (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  client_id uuid not null,
  code text not null,
  created_at timestamptz not null default now(),
  unique (client_id, code)
);

create table if not exists public.promo_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  attempted_at timestamptz not null default now()
);

create table if not exists public.booking_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.promo_redemptions enable row level security;
alter table public.promo_attempts enable row level security;
alter table public.booking_attempts enable row level security;
revoke all on public.promo_redemptions, public.promo_attempts, public.booking_attempts from anon, authenticated;

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- C-1 : seule la clé service, et seulement si l'intention, le montant et la devise concordent.
revoke all on function public.confirm_online_payment(uuid) from public, anon, authenticated, service_role;
drop function if exists public.confirm_online_payment(uuid);

create or replace function public.confirm_online_payment(p_booking uuid, p_intent text, p_amount int, p_currency text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  p public.payments%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select * into b from public.bookings where id = p_booking for update;
  select * into p from public.payments where booking_id = p_booking for update;
  if not found or p.stripe_payment_intent_id is distinct from p_intent
     or p.amount_cents <> p_amount or lower(p_currency) <> 'cad' then
    raise exception 'Paiement incohérent';
  end if;
  if b.status = 'confirme' and p.status = 'paye' then
    return p_booking;
  end if;
  if b.status <> 'en_attente_paiement' then
    raise exception 'État invalide';
  end if;
  update public.bookings set status = 'confirme', payment_method = 'en_ligne' where id = p_booking;
  update public.payments set status = 'paye', method = 'en_ligne' where booking_id = p_booking;
  return p_booking;
end;
$$;

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
  set refunded_cents = p_refunded,
      stripe_refund_cents = greatest(stripe_refund_cents, p_refunded),
      status = case
        when p_refunded >= amount_cents then 'rembourse'::public.payment_status
        when p_refunded > 0 then 'rembourse_partiel'::public.payment_status
        else status
      end
  where stripe_payment_intent_id = p_intent;
end;
$$;

create or replace function public.release_promo(p_booking uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select promo_code into v_code from public.bookings where id = p_booking;
  if v_code is null then
    return;
  end if;
  if exists (select 1 from public.promo_redemptions where booking_id = p_booking) then
    delete from public.promo_redemptions where booking_id = p_booking;
    update public.promo_codes set usage_count = greatest(0, usage_count - 1) where code = v_code;
  end if;
end;
$$;

-- E-1
revoke all on function public.enqueue_booking_notifications(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.trg_booking_notifications() from public, anon, authenticated;

-- M-9 : le propriétaire doit être en aal2 pour l'argent, l'équipe et les réglages.
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
     and p_action in ('refund', 'team', 'payments', 'settings', 'promos', 'services')
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Vérification renforcée requise' using errcode = '42501';
  end if;
end;
$$;

-- M-1
create or replace function public.assert_barber_scope(p_barber uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mine uuid := public.current_barber_id();
begin
  perform public.assert_staff('agenda');
  if public.current_role() = 'proprietaire' then
    return p_barber;
  end if;
  if v_mine is null or (p_barber is not null and p_barber <> v_mine) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return v_mine;
end;
$$;

create or replace function public.admin_day(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_barber uuid;
  v_money boolean;
begin
  perform public.assert_staff('day');
  v_money := public.current_role() = 'proprietaire';
  v_barber := case when public.current_role() = 'coiffeur' then public.assert_barber_scope(null) else null end;
  return jsonb_build_object(
    'from', p_date,
    'to', p_date,
    'cuts', (select count(*) from public.bookings b where (b.starts_at at time zone 'America/Toronto')::date = p_date and b.status in ('honore', 'confirme') and (v_barber is null or b.barber_id = v_barber)),
    'booked', (select count(*) from public.bookings b where (b.starts_at at time zone 'America/Toronto')::date = p_date and (v_barber is null or b.barber_id = v_barber)),
    'cancelled', (select count(*) from public.bookings b where (b.starts_at at time zone 'America/Toronto')::date = p_date and b.status in ('annule', 'annule_tardif') and (v_barber is null or b.barber_id = v_barber)),
    'occupancy', 0,
    'revenueHtCents', case when v_money then (select coalesce(sum(price_cents), 0) from public.bookings b where (b.starts_at at time zone 'America/Toronto')::date = p_date and b.status in ('honore', 'confirme')) else null end,
    'revenueTtcCents', case when v_money then (select coalesce(sum(total_cents), 0) from public.bookings b where (b.starts_at at time zone 'America/Toronto')::date = p_date and b.status in ('honore', 'confirme')) else null end,
    'perBarber', '[]'::jsonb,
    'topServices', '[]'::jsonb
  );
end;
$$;

create or replace function public.admin_clients()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_barber uuid;
  v_money boolean;
begin
  perform public.assert_staff('clients');
  v_money := public.current_role() = 'proprietaire';
  v_barber := case when public.current_role() = 'coiffeur' then public.assert_barber_scope(null) else null end;
  return (
    with keyed as (
      select
        b.*,
        case when b.client_id is not null then 'user:' || b.client_id::text else 'guest:' || b.id::text end as file_id
      from public.bookings b
      where v_barber is null or b.barber_id = v_barber
    ),
    files as (
      select
        k.file_id,
        max(k.client_name) as client_name,
        count(*) filter (where k.status = 'honore') as visits,
        max(l.points) as points,
        max(l.stamps) as stamps,
        sum(k.price_cents) filter (where k.status = 'honore') as spent
      from keyed k
      left join public.loyalty_accounts l on l.client_id = k.client_id
      group by k.file_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.file_id,
      'name', f.client_name,
      'visits', f.visits,
      'note', coalesce((select note from public.client_notes n where n.client_key = f.file_id), ''),
      'points', case when v_money then f.points else null end,
      'stamps', case when v_money then f.stamps else null end,
      'spentHtCents', case when v_money then f.spent else null end,
      'history', '[]'::jsonb
    )), '[]'::jsonb)
    from files f
  );
end;
$$;

create or replace function public.admin_save_note(p_client text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('clients');
  if public.current_role() = 'coiffeur' and not exists (
    select 1 from public.bookings
    where barber_id = public.current_barber_id()
      and (case when client_id is not null then 'user:' || client_id::text else 'guest:' || id::text end) = p_client
  ) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  insert into public.client_notes (client_key, note, updated_by, updated_at)
  values (p_client, trim(p_note), auth.uid(), now())
  on conflict (client_key) do update set note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

create or replace function public.purge_client_notes()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  delete from public.client_notes where updated_at < now() - interval '24 months';
end;
$$;

-- M-7
create or replace function public.visible_reviews(p_barber uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_role() = 'coiffeur' and p_barber is distinct from public.current_barber_id() then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'barberId', r.barber_id,
      'serviceId', r.service_id,
      'clientName', case
        when split_part(btrim(r.client_name), ' ', 2) = '' then split_part(btrim(r.client_name), ' ', 1)
        else split_part(btrim(r.client_name), ' ', 1) || ' ' || left(split_part(btrim(r.client_name), ' ', 2), 1) || '.'
      end,
      'serviceName', s.name,
      'stars', r.stars,
      'body', r.body,
      'status', r.status,
      'date', to_char(r.created_at at time zone 'America/Toronto', 'YYYY-MM-DD')
    ) order by r.created_at desc), '[]'::jsonb)
    from public.reviews r
    left join public.services s on s.id = r.service_id
    where r.barber_id = p_barber
      and (public.is_proprietaire() or r.status = 'publie')
  );
end;
$$;

-- F-6 et M-8
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
    raise exception 'Trop de tentatives. Réessaie plus tard.';
  end if;
  select * into promo from public.promo_codes where upper(code) = upper(trim(p_code));
  if not found then
    raise exception 'Ce code n’est pas reconnu.';
  end if;
  if p_date < promo.starts_on or p_date > promo.ends_on then
    raise exception 'Ce code n’est pas valable à cette date.';
  end if;
  if promo.usage_limit is not null and promo.usage_count >= promo.usage_limit then
    raise exception 'Ce code a atteint sa limite.';
  end if;
  if promo.discount_type = 'percent' then
    v_discount := round(p_subtotal * promo.value / 100.0);
  else
    v_discount := least((promo.value * 100)::int, p_subtotal);
  end if;
  if v_discount <= 0 then
    raise exception 'Ce code ne change pas le montant.';
  end if;
  return jsonb_build_object('code', promo.code, 'discountCents', v_discount);
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
  promo public.promo_codes%rowtype;
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
  select * into promo from public.promo_codes where upper(code) = upper(trim(p_code)) for update;
  v_quote := public.validate_promo(p_code, (b.starts_at at time zone 'America/Toronto')::date, b.price_cents + b.discount_cents);
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

-- M-4 : courriel confirmé, 3 rendez-vous à venir, 8 créations par heure.
create or replace function public.create_booking(
  p_service_id uuid,
  p_barber_id uuid,
  p_date date,
  p_start_minute int,
  p_method public.payment_method,
  p_redeem boolean
) returns uuid
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
  if not exists (select 1 from public.profiles where id = v_user and active) then
    raise exception 'Profil inactif' using errcode = '42501';
  end if;
  if (select email_confirmed_at from auth.users where id = v_user) is null then
    raise exception 'Confirme ton courriel avant de réserver.';
  end if;
  insert into public.booking_attempts (user_id) values (v_user);
  if (select count(*) from public.booking_attempts where user_id = v_user and created_at > now() - interval '1 hour') > 8 then
    raise exception 'Trop de réservations. Réessaie dans une heure.';
  end if;
  if (
    select count(*) from public.bookings
    where client_id = v_user and starts_at > now() and status in ('en_attente_paiement', 'confirme')
  ) >= 3 then
    raise exception 'Tu as déjà trois rendez-vous à venir.';
  end if;
  perform 1 from public.barbers where id = p_barber_id for update;
  select full_name into v_name from public.profiles where id = v_user;
  select duration_minutes, price_cents into v_duration, v_price
  from public.services where id = p_service_id and active;
  if v_duration is null then
    raise exception 'Prestation introuvable.';
  end if;
  if not exists (
    select 1 from public.barber_services where barber_id = p_barber_id and service_id = p_service_id
  ) then
    raise exception 'Ce coiffeur ne fait pas cette prestation.';
  end if;
  v_dow := extract(dow from p_date)::int;
  v_occupancy := public.occupancy_minutes(v_duration);
  if v_dow < 2 or v_dow > 6 or p_start_minute < 540 or p_start_minute % 15 <> 0 or p_start_minute + v_occupancy > 1140 then
    raise exception 'Créneau invalide.';
  end if;
  v_starts := (p_date::timestamp + make_interval(mins => p_start_minute)) at time zone 'America/Toronto';
  if v_starts <= now() then
    raise exception 'Ce créneau est déjà passé.';
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
    raise exception 'Ce créneau n’est plus libre.';
  end if;
  if p_redeem then
    select rewards_available into v_rewards from public.loyalty_accounts where client_id = v_user for update;
    if coalesce(v_rewards, 0) < 1 then
      raise exception 'Aucune coupe offerte à utiliser.';
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
  return v_id;
end;
$$;

-- M-5
create or replace function public.confirm_on_site(p_booking uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bookings
  set status = 'confirme', payment_method = 'sur_place'
  where id = p_booking and client_id = auth.uid() and status = 'en_attente_paiement'
    and not exists (select 1 from public.payments where booking_id = p_booking and status = 'paye');
  if not found then
    raise exception 'Rendez-vous introuvable.';
  end if;
  update public.payments
  set status = 'a_encaisser', method = 'sur_place'
  where booking_id = p_booking and status in ('en_attente', 'a_encaisser');
  return p_booking;
end;
$$;

create or replace function public.abandon_checkout(p_booking uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redeem boolean;
  v_intent text;
begin
  select b.loyalty_redeemed, p.stripe_payment_intent_id
  into v_redeem, v_intent
  from public.bookings b
  join public.payments p on p.booking_id = b.id
  where b.id = p_booking and b.client_id = auth.uid() and b.status = 'en_attente_paiement';
  if not found then
    return;
  end if;
  if v_intent is not null then
    raise exception 'Annule d’abord le paiement en cours.';
  end if;
  perform public.release_promo(p_booking);
  if v_redeem then
    update public.loyalty_accounts
    set rewards_available = rewards_available + 1
    where client_id = auth.uid();
  end if;
  delete from public.bookings where id = p_booking;
end;
$$;

create or replace function public.service_finish_abandon(p_booking uuid, p_user uuid, p_refund boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select * into b from public.bookings where id = p_booking and client_id = p_user and status = 'en_attente_paiement' for update;
  if not found then
    return;
  end if;
  perform public.release_promo(p_booking);
  if b.loyalty_redeemed then
    update public.loyalty_accounts set rewards_available = rewards_available + 1 where client_id = p_user;
  end if;
  if p_refund then
    update public.bookings set status = 'annule', cancelled_at = now(), loyalty_redeemed = false where id = b.id;
    update public.payments
    set status = 'remboursement_en_cours', refunded_cents = amount_cents
    where booking_id = b.id;
  else
    update public.payments set stripe_payment_intent_id = null where booking_id = b.id;
    delete from public.bookings where id = b.id;
  end if;
end;
$$;

-- E-2 : un paiement Stripe reste « en cours » tant que le webhook n'a pas confirmé le remboursement.
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
    v_refund := case when not v_within and v_paid then b.total_cents else 0 end;
    update public.bookings
    set status = 'annule', cancelled_at = now(), loyalty_redeemed = false
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
  if b.loyalty_redeemed then
    update public.loyalty_accounts set rewards_available = rewards_available + 1 where client_id = auth.uid();
  end if;
  select gst_number, qst_number into v_gst_number, v_qst_number from public.salon_settings where id = 1;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (
    auth.uid(),
    'cancellation',
    'booking',
    b.id::text,
    jsonb_build_object(
      'within24h', v_within,
      'feeCents', v_fee,
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
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'remboursement_frais', 'booking', p_booking::text, jsonb_build_object('feeCents', v_fee, 'client', v_name, 'stripe', v_intent is not null));
end;
$$;

create or replace function public.admin_set_role(p_user uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_barber uuid;
begin
  perform public.assert_staff('team');
  if p_role = 'client' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select barber_id into v_barber from public.profiles where id = p_user;
  if p_role = 'coiffeur' and v_barber is null then
    raise exception 'Choisis la chaise de ce coiffeur.';
  end if;
  if p_role = 'coiffeur' and exists (
    select 1 from public.profiles where barber_id = v_barber and active and id <> p_user
  ) then
    raise exception 'Cette chaise a déjà un compte actif.';
  end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'proprietaire' and active)
     and p_role <> 'proprietaire'
     and (select count(*) from public.profiles where role = 'proprietaire' and active and id <> p_user) < 1 then
    raise exception 'Il doit rester au moins un propriétaire actif.';
  end if;
  select full_name into v_name from public.profiles where id = p_user;
  update public.profiles set role = p_role where id = p_user and role <> 'client';
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'role', 'profile', p_user::text, jsonb_build_object('role', p_role, 'name', v_name));
end;
$$;

-- M-4 : les réservations en attente de plus de 15 minutes libèrent le créneau.
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

-- F-2
create or replace function public.set_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null or length(trim(p_token)) < 8 then
    raise exception 'Connecte-toi pour continuer.';
  end if;
  select user_id into v_owner from public.push_tokens where token = trim(p_token);
  if v_owner is not null and v_owner is distinct from auth.uid() then
    raise exception 'Ce téléphone est déjà lié à un autre compte.';
  end if;
  insert into public.push_tokens (token, user_id) values (trim(p_token), auth.uid())
  on conflict (token) do update set user_id = excluded.user_id;
end;
$$;

create or replace function public.clear_my_push_tokens()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  delete from public.push_tokens where user_id = auth.uid();
end;
$$;

create or replace function public.set_notification_opt_in(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Connecte-toi pour continuer.';
  end if;
  insert into public.notification_prefs (user_id, enabled) values (auth.uid(), p_enabled)
  on conflict (user_id) do update set enabled = excluded.enabled;
  if not p_enabled then
    delete from public.push_tokens where user_id = auth.uid();
  end if;
end;
$$;

-- E-6
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
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'proprietaire' and active)
     and (select count(*) from public.profiles where role = 'proprietaire' and active and id <> p_user) < 1 then
    raise exception 'Il doit rester au moins un propriétaire actif.';
  end if;
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

-- M-6 : le profil invité s'active à la première connexion.
create or replace function public.activate_invited_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.last_sign_in_at is not null and old.last_sign_in_at is distinct from new.last_sign_in_at then
    update public.profiles set active = true where id = new.id and active = false and invited_at is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_signed_in on auth.users;
create trigger on_auth_user_signed_in
after update of last_sign_in_at on auth.users
for each row execute function public.activate_invited_profile();

revoke all on function public.assert_staff(text) from public, anon, authenticated;
revoke all on function public.assert_barber_scope(uuid) from public, anon, authenticated;
revoke all on function public.confirm_online_payment(uuid, text, int, text) from public, anon, authenticated;
revoke all on function public.sync_stripe_refund(text, int) from public, anon, authenticated;
revoke all on function public.release_promo(uuid) from public, anon, authenticated;
revoke all on function public.service_finish_abandon(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.expire_stale_checkouts() from public, anon, authenticated;
revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
revoke all on function public.anonymize_client(uuid) from public, anon, authenticated;
revoke all on function public.purge_client_notes() from public, anon, authenticated;
revoke all on function public.activate_invited_profile() from public, anon, authenticated;
revoke all on function public.validate_promo(text, date, int) from public, anon;

grant execute on function public.confirm_online_payment(uuid, text, int, text) to service_role;
grant execute on function public.sync_stripe_refund(text, int) to service_role;
grant execute on function public.service_finish_abandon(uuid, uuid, boolean) to service_role;
grant execute on function public.expire_stale_checkouts() to service_role;
grant execute on function public.prepare_account_deletion(uuid) to service_role;
grant execute on function public.anonymize_client(uuid) to service_role;
grant execute on function public.purge_client_notes() to service_role;
grant execute on function public.validate_promo(text, date, int) to authenticated;
grant execute on function public.clear_my_push_tokens() to authenticated;
grant execute on function public.visible_reviews(uuid) to anon, authenticated;
