-- Le Nanomètre — schéma, droits et règles métier.
-- Les calculs de taxes et de frais reprennent src/domain (TPS/TVQ par ligne, LTA 182 / LTVQ 318).

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.user_role as enum ('client', 'coiffeur', 'proprietaire');
create type public.payment_method as enum ('en_ligne', 'sur_place');
create type public.booking_status as enum ('en_attente_paiement', 'confirme', 'honore', 'annule', 'annule_tardif');
create type public.payment_status as enum ('en_attente', 'paye', 'a_encaisser', 'rembourse_partiel', 'rembourse', 'echoue');
create type public.review_status as enum ('en_attente', 'publie', 'masque');

create table public.salon_settings (
  id int primary key default 1 check (id = 1),
  name text not null,
  tagline text not null,
  address text not null,
  city text not null,
  timezone text not null default 'America/Toronto',
  open_minute int not null default 540,
  close_minute int not null default 1140,
  gst_number text not null,
  qst_number text not null,
  phone text not null
);

create table public.barbers (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  full_name text not null,
  short_name text not null,
  specialty text not null,
  bio text not null,
  years int not null,
  photo_path text not null,
  rating numeric(3, 2) not null default 0,
  review_count int not null default 0,
  active boolean not null default true,
  sort_order int not null
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text not null,
  duration_minutes int not null check (duration_minutes > 0),
  price_cents int not null check (price_cents >= 0),
  photo_path text not null,
  active boolean not null default true,
  sort_order int not null
);

create table public.barber_services (
  barber_id uuid not null references public.barbers (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  primary key (barber_id, service_id)
);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  start_minute int not null,
  end_minute int not null,
  unique (barber_id, weekday)
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'client',
  full_name text not null,
  phone text,
  barber_id uuid references public.barbers (id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.blocked_slots (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_by uuid references public.profiles (id),
  check (ends_at > starts_at)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.profiles (id),
  client_name text not null,
  barber_id uuid not null references public.barbers (id),
  service_id uuid not null references public.services (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_minutes int not null,
  price_cents int not null,
  gst_cents int not null,
  qst_cents int not null,
  total_cents int not null,
  payment_method public.payment_method not null,
  status public.booking_status not null,
  loyalty_redeemed boolean not null default false,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status in ('en_attente_paiement', 'confirme', 'honore'));

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  method public.payment_method not null,
  status public.payment_status not null,
  amount_cents int not null,
  refunded_cents int not null default 0,
  fee_cents int not null default 0,
  fee_gst_cents int not null default 0,
  fee_qst_cents int not null default 0,
  fee_ht_cents int not null default 0,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now()
);

create table public.loyalty_accounts (
  client_id uuid primary key references public.profiles (id) on delete cascade,
  points int not null default 0 check (points >= 0),
  stamps int not null default 0 check (stamps between 0 and 9),
  rewards_available int not null default 0 check (rewards_available >= 0)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings (id),
  client_id uuid references public.profiles (id),
  barber_id uuid not null references public.barbers (id),
  service_id uuid references public.services (id),
  client_name text not null,
  stars int not null check (stars between 1 and 5),
  body text not null,
  status public.review_status not null default 'en_attente',
  created_at timestamptz not null default now()
);

create table public.promo_codes (
  code text primary key,
  discount_type text not null check (discount_type in ('percent', 'amount')),
  value numeric not null,
  starts_on date not null,
  ends_on date not null,
  usage_limit int,
  usage_count int not null default 0
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id),
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.current_barber_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select barber_id from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_proprietaire()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() = 'proprietaire'
$$;

create or replace function public.line_taxes(p_cents int)
returns table (gst_cents int, qst_cents int, total_cents int)
language sql
immutable
as $$
  select
    (round((p_cents::numeric / 100) * 0.05, 2) * 100)::int,
    (round((p_cents::numeric / 100) * 0.09975, 2) * 100)::int,
    p_cents
      + (round((p_cents::numeric / 100) * 0.05, 2) * 100)::int
      + (round((p_cents::numeric / 100) * 0.09975, 2) * 100)::int
$$;

create or replace function public.occupancy_minutes(p_duration int)
returns int
language sql
immutable
as $$
  select (ceil(p_duration / 15.0))::int * 15
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
    'phone', phone
  ))
  from public.salon_settings
  where id = 1
$$;

create or replace function public.visible_barbers()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'slug', slug,
    'fullName', full_name,
    'shortName', short_name,
    'specialty', specialty,
    'bio', bio,
    'years', years,
    'photo', photo_path,
    'rating', rating,
    'reviewCount', review_count,
    'sortOrder', sort_order
  ) order by sort_order), '[]'::jsonb)
  from public.barbers
  where active
$$;

create or replace function public.visible_services()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'slug', slug,
    'name', name,
    'description', description,
    'durationMinutes', duration_minutes,
    'priceCents', case when public.current_role() = 'coiffeur' then null else price_cents end,
    'photo', photo_path,
    'sortOrder', sort_order
  ) order by sort_order), '[]'::jsonb)
  from public.services
  where active
$$;

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
      'clientName', r.client_name,
      'serviceName', s.name,
      'stars', r.stars,
      'body', r.body,
      'status', r.status,
      'date', to_char(r.created_at at time zone 'America/Toronto', 'YYYY-MM-DD')
    ) order by r.created_at desc), '[]'::jsonb)
    from public.reviews r
    left join public.services s on s.id = r.service_id
    where r.barber_id = p_barber
      and (
        public.is_proprietaire()
        or r.status = 'publie'
      )
  );
end;
$$;

create or replace function public.list_slots(p_service_id uuid, p_date date, p_barber_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_duration int;
  v_occupancy int;
  v_dow int;
  v_last int;
  v_start int;
  v_barber uuid;
  v_rows jsonb := '[]'::jsonb;
  v_available boolean;
  v_assigned uuid;
  v_slot_start timestamptz;
  v_window tstzrange;
begin
  select duration_minutes into v_duration from public.services where id = p_service_id and active;
  if v_duration is null then
    raise exception 'Prestation introuvable';
  end if;
  v_occupancy := public.occupancy_minutes(v_duration);
  v_dow := extract(dow from p_date)::int;
  if v_dow < 2 or v_dow > 6 then
    return '[]'::jsonb;
  end if;
  v_last := 19 * 60 - v_occupancy;
  v_start := 9 * 60;
  while v_start <= v_last loop
    v_available := false;
    v_assigned := null;
    v_slot_start := (p_date::timestamp + make_interval(mins => v_start)) at time zone 'America/Toronto';
    if v_slot_start > now() then
      for v_barber in
        select b.id
        from public.barbers b
        join public.barber_services bs on bs.barber_id = b.id and bs.service_id = p_service_id
        where b.active and (p_barber_id is null or b.id = p_barber_id)
        order by (
          select count(*) from public.bookings bk
          where bk.barber_id = b.id
            and (bk.starts_at at time zone 'America/Toronto')::date = p_date
            and bk.status in ('en_attente_paiement', 'confirme', 'honore')
        ), b.sort_order
      loop
        v_window := tstzrange(v_slot_start, v_slot_start + make_interval(mins => v_occupancy), '[)');
        if not exists (
          select 1 from public.bookings bk
          where bk.barber_id = v_barber
            and bk.status in ('en_attente_paiement', 'confirme', 'honore')
            and tstzrange(bk.starts_at, bk.starts_at + make_interval(mins => public.occupancy_minutes(bk.duration_minutes)), '[)') && v_window
        ) and not exists (
          select 1 from public.blocked_slots s
          where s.barber_id = v_barber
            and tstzrange(s.starts_at, s.ends_at, '[)') && v_window
        ) then
          v_available := true;
          v_assigned := v_barber;
          exit;
        end if;
      end loop;
    end if;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'startMinute', v_start,
      'endMinute', v_start + v_duration,
      'available', v_available,
      'barberId', v_assigned
    ));
    v_start := v_start + 15;
  end loop;
  return v_rows;
end;
$$;

create or replace function public.booking_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id,
    'clientId', b.client_id,
    'clientName', case when public.current_role() = 'coiffeur' then b.client_name else b.client_name end,
    'barberId', b.barber_id,
    'serviceId', b.service_id,
    'date', to_char(b.starts_at at time zone 'America/Toronto', 'YYYY-MM-DD'),
    'startMinute', (extract(hour from b.starts_at at time zone 'America/Toronto')::int * 60 + extract(minute from b.starts_at at time zone 'America/Toronto')::int),
    'durationMinutes', b.duration_minutes,
    'priceCents', case when public.current_role() = 'coiffeur' then null else b.price_cents end,
    'gstCents', case when public.current_role() = 'coiffeur' then null else b.gst_cents end,
    'qstCents', case when public.current_role() = 'coiffeur' then null else b.qst_cents end,
    'totalCents', case when public.current_role() = 'coiffeur' then null else b.total_cents end,
    'paymentMethod', b.payment_method,
    'status', b.status,
    'paymentStatus', case when public.current_role() = 'coiffeur' then null else p.status end,
    'refundedCents', case when public.current_role() = 'coiffeur' then null else p.refunded_cents end,
    'feeCents', case when public.current_role() = 'coiffeur' then null else p.fee_cents end,
    'feeGstCents', case when public.current_role() = 'coiffeur' then null else p.fee_gst_cents end,
    'feeQstCents', case when public.current_role() = 'coiffeur' then null else p.fee_qst_cents end,
    'feeHtCents', case when public.current_role() = 'coiffeur' then null else p.fee_ht_cents end,
    'loyaltyRedeemed', b.loyalty_redeemed,
    'barberName', br.full_name,
    'serviceName', sv.name,
    'barberPhoto', br.photo_path,
    'servicePhoto', sv.photo_path
  )
  from public.bookings b
  join public.payments p on p.booking_id = b.id
  join public.barbers br on br.id = b.barber_id
  join public.services sv on sv.id = b.service_id
  where b.id = p_id
    and (
      b.client_id = auth.uid()
      or public.is_proprietaire()
      or (public.current_role() = 'coiffeur' and b.barber_id = public.current_barber_id())
    )
$$;

create or replace function public.my_bookings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.booking_json(b.id) order by b.starts_at), '[]'::jsonb)
  from public.bookings b
  where b.client_id = auth.uid()
     or public.is_proprietaire()
     or (public.current_role() = 'coiffeur' and b.barber_id = public.current_barber_id())
$$;

create or replace function public.my_loyalty()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_role();
begin
  if v_role = 'coiffeur' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if auth.uid() is null then
    raise exception 'Connexion requise';
  end if;
  return jsonb_build_array(jsonb_build_object(
    'points', coalesce((select points from public.loyalty_accounts where client_id = auth.uid()), 0),
    'stamps', coalesce((select stamps from public.loyalty_accounts where client_id = auth.uid()), 0),
    'rewardsAvailable', coalesce((select rewards_available from public.loyalty_accounts where client_id = auth.uid()), 0),
    'cutsPerReward', 10
  ));
end;
$$;

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

create or replace function public.confirm_online_payment(p_booking uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then
    raise exception 'Ce paiement ne peut pas être confirmé.';
  end if;
  if auth.role() is distinct from 'service_role' and b.client_id is distinct from auth.uid() then
    raise exception 'Ce paiement ne peut pas être confirmé.';
  end if;
  if b.status = 'confirme' and b.payment_method = 'en_ligne' then
    return p_booking;
  end if;
  if b.status <> 'en_attente_paiement' then
    raise exception 'Ce paiement ne peut pas être confirmé.';
  end if;
  update public.bookings
  set status = 'confirme', payment_method = 'en_ligne'
  where id = p_booking;
  update public.payments set status = 'paye', method = 'en_ligne' where booking_id = p_booking;
  return p_booking;
end;
$$;

create or replace function public.confirm_on_site(p_booking uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bookings
  set status = 'confirme', payment_method = 'sur_place'
  where id = p_booking and client_id = auth.uid() and status in ('en_attente_paiement', 'confirme');
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
begin
  select loyalty_redeemed into v_redeem
  from public.bookings
  where id = p_booking and client_id = auth.uid() and status = 'en_attente_paiement';
  if not found then
    return;
  end if;
  if v_redeem then
    update public.loyalty_accounts
    set rewards_available = rewards_available + 1
    where client_id = auth.uid();
  end if;
  delete from public.bookings where id = p_booking;
end;
$$;

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
    set status = 'rembourse_partiel',
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
    set status = case when v_paid then 'rembourse'::public.payment_status else 'echoue'::public.payment_status end,
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
      'gstNumber', v_gst_number,
      'qstNumber', v_qst_number
    )
  );
  return b.id;
end;
$$;

create or replace function public.submit_review(p_booking uuid, p_stars int, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  v_id uuid := gen_random_uuid();
  v_name text;
begin
  if p_stars < 1 or p_stars > 5 then
    raise exception 'Choisis une note entre 1 et 5.';
  end if;
  select * into b from public.bookings where id = p_booking and client_id = auth.uid();
  if not found or b.status <> 'honore' then
    raise exception 'Tu pourras laisser un avis une fois la coupe honorée.';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.reviews (id, booking_id, client_id, barber_id, service_id, client_name, stars, body, status)
  values (v_id, b.id, auth.uid(), b.barber_id, b.service_id, v_name, p_stars, trim(p_body), 'en_attente');
  return v_id;
end;
$$;

create or replace function public.prevent_profile_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.role = 'proprietaire' and old.active and (new.role <> 'proprietaire' or not new.active) then
      if (select count(*) from public.profiles where role = 'proprietaire' and active and id <> old.id) < 1 then
        raise exception 'Il doit rester au moins un propriétaire actif';
      end if;
    end if;
    if auth.uid() is not null and not public.is_proprietaire() and auth.uid() = new.id then
      new.role := old.role;
      new.barber_id := old.barber_id;
      new.active := old.active;
    end if;
    if old.role is distinct from new.role or old.active is distinct from new.active then
      insert into public.audit_log (actor_id, action, entity, entity_id, detail)
      values (
        auth.uid(),
        case when old.role is distinct from new.role then 'role_change' else 'deactivate' end,
        'profile',
        new.id::text,
        jsonb_build_object('from', old.role, 'to', new.role, 'active', new.active)
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard
before update on public.profiles
for each row execute function public.prevent_profile_escalation();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), 'client')
  on conflict (id) do nothing;
  insert into public.loyalty_accounts (client_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.salon_settings enable row level security;
alter table public.barbers enable row level security;
alter table public.services enable row level security;
alter table public.barber_services enable row level security;
alter table public.schedules enable row level security;
alter table public.profiles enable row level security;
alter table public.blocked_slots enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.reviews enable row level security;
alter table public.promo_codes enable row level security;
alter table public.audit_log enable row level security;

revoke all on all tables in schema public from anon, authenticated;

grant select, update on public.profiles to authenticated;

create policy profiles_select on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_proprietaire());

create policy profiles_update on public.profiles
for update to authenticated
using (id = auth.uid() or public.is_proprietaire())
with check (id = auth.uid() or public.is_proprietaire());

revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function public.salon_public() to anon, authenticated;
grant execute on function public.visible_barbers() to anon, authenticated;
grant execute on function public.visible_services() to anon, authenticated;
grant execute on function public.visible_reviews(uuid) to anon, authenticated;
grant execute on function public.list_slots(uuid, date, uuid) to anon, authenticated;
grant execute on function public.my_bookings() to authenticated;
grant execute on function public.my_loyalty() to authenticated;
grant execute on function public.booking_json(uuid) to authenticated;
grant execute on function public.create_booking(uuid, uuid, date, int, public.payment_method, boolean) to authenticated;
grant execute on function public.confirm_online_payment(uuid) to authenticated;
grant execute on function public.confirm_on_site(uuid) to authenticated;
grant execute on function public.abandon_checkout(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.submit_review(uuid, int, text) to authenticated;
grant execute on function public.confirm_online_payment(uuid) to service_role;
