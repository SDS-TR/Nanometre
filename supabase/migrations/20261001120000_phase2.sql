-- Phase 2 : espace équipe, promotions, fidélité à l'honneur, notifications, politique sur place.

alter table public.salon_settings
  add column if not exists onsite_late_policy text not null default 'aucun';

alter table public.salon_settings
  drop constraint if exists salon_settings_onsite_late_policy_check;
alter table public.salon_settings
  add constraint salon_settings_onsite_late_policy_check
  check (onsite_late_policy in ('aucun', 'a_la_prochaine'));

alter table public.bookings
  add column if not exists promo_code text,
  add column if not exists discount_cents int not null default 0,
  add column if not exists fee_owing_cents int not null default 0;

create table if not exists public.client_notes (
  client_key text primary key,
  note text not null default '',
  updated_by uuid
);

create table if not exists public.notification_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  enabled boolean not null default false
);

create table if not exists public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  booking_id uuid,
  kind text not null,
  title text not null,
  body text not null,
  path text not null,
  send_at timestamptz not null,
  status text not null default 'planifie'
);

alter table public.client_notes enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.notification_jobs enable row level security;
revoke all on public.client_notes, public.notification_prefs, public.notification_jobs from anon, authenticated;

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
end;
$$;

create or replace function public.assert_barber_scope(p_barber uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('agenda');
  if public.current_role() = 'proprietaire' then
    return p_barber;
  end if;
  if p_barber is not null and p_barber is distinct from public.current_barber_id() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return public.current_barber_id();
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
    'phone', phone,
    'onsiteLatePolicy', onsite_late_policy
  ))
  from public.salon_settings
  where id = 1
$$;

create or replace function public.validate_promo(p_code text, p_date date, p_subtotal int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  promo public.promo_codes%rowtype;
  v_discount int;
begin
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
  v_quote jsonb;
  v_discount int;
  v_net int;
  v_tax record;
begin
  select * into b from public.bookings where id = p_booking and client_id = auth.uid();
  if not found or b.status not in ('en_attente_paiement', 'confirme') then
    raise exception 'Ce code ne peut pas être appliqué.';
  end if;
  v_quote := public.validate_promo(p_code, (b.starts_at at time zone 'America/Toronto')::date, b.price_cents + b.discount_cents);
  v_discount := (v_quote->>'discountCents')::int;
  v_net := greatest(0, b.price_cents + b.discount_cents - v_discount);
  select * into v_tax from public.line_taxes(v_net);
  update public.bookings
  set price_cents = v_net, discount_cents = v_discount, promo_code = v_quote->>'code',
      gst_cents = v_tax.gst_cents, qst_cents = v_tax.qst_cents, total_cents = v_tax.total_cents
  where id = b.id;
  update public.payments set amount_cents = v_tax.total_cents where booking_id = b.id;
  update public.promo_codes set usage_count = usage_count + 1 where code = v_quote->>'code';
  return b.id;
end;
$$;

create or replace function public.enqueue_booking_notifications(p_booking uuid, p_kind text, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  v_barber_user uuid;
  v_send timestamptz;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then
    return;
  end if;
  select id into v_barber_user from public.profiles where barber_id = b.barber_id and role in ('coiffeur', 'proprietaire') limit 1;
  if p_kind = 'confirmation' then
    v_send := now();
  elsif p_kind = 'rappel_24h' then
    v_send := b.starts_at - interval '24 hours';
  elsif p_kind = 'rappel_2h' then
    v_send := b.starts_at - interval '2 hours';
  else
    v_send := now();
  end if;
  if v_send <= now() and p_kind like 'rappel%' then
    return;
  end if;
  if b.client_id is not null and exists (select 1 from public.notification_prefs where user_id = b.client_id and enabled) then
    insert into public.notification_jobs (user_id, booking_id, kind, title, body, path, send_at)
    values (b.client_id, b.id, p_kind, p_title, p_body, '/rendez-vous?booking=' || b.id::text, v_send);
  end if;
  if p_kind in ('confirmation', 'annulation', 'changement') and v_barber_user is not null
     and exists (select 1 from public.notification_prefs where user_id = v_barber_user and enabled) then
    insert into public.notification_jobs (user_id, booking_id, kind, title, body, path, send_at)
    values (
      v_barber_user,
      b.id,
      p_kind,
      case when p_kind = 'confirmation' then 'Nouveau rendez-vous' else p_title end,
      p_body,
      '/rendez-vous?booking=' || b.id::text,
      v_send
    );
  end if;
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
end;
$$;

create or replace function public.notification_opt_in()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select enabled from public.notification_prefs where user_id = auth.uid()), false)
$$;

create or replace function public.my_notifications()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', kind, 'title', title, 'body', body, 'path', path,
    'sendAt', send_at, 'status', status
  ) order by send_at), '[]'::jsonb)
  from public.notification_jobs
  where user_id = auth.uid()
$$;

create or replace function public.admin_dashboard(p_anchor date, p_period text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date;
  v_to date;
begin
  perform public.assert_staff('dashboard');
  if p_period = 'mois' then
    v_from := date_trunc('month', p_anchor)::date;
    v_to := (v_from + interval '1 month' - interval '1 day')::date;
  elsif p_period = 'semaine' then
    v_from := p_anchor - ((extract(dow from p_anchor)::int + 5) % 7);
    v_to := v_from + 4;
  else
    v_from := p_anchor;
    v_to := p_anchor;
  end if;
  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'cuts', (select count(*) from public.bookings where (starts_at at time zone 'America/Toronto')::date between v_from and v_to and status in ('honore', 'confirme')),
    'booked', (select count(*) from public.bookings where (starts_at at time zone 'America/Toronto')::date between v_from and v_to),
    'cancelled', (select count(*) from public.bookings where (starts_at at time zone 'America/Toronto')::date between v_from and v_to and status in ('annule', 'annule_tardif')),
    'occupancy', 0,
    'revenueHtCents', (select coalesce(sum(price_cents), 0) from public.bookings where (starts_at at time zone 'America/Toronto')::date between v_from and v_to and status in ('honore', 'confirme')),
    'revenueTtcCents', (select coalesce(sum(total_cents), 0) from public.bookings where (starts_at at time zone 'America/Toronto')::date between v_from and v_to and status in ('honore', 'confirme')),
    'perBarber', '[]'::jsonb,
    'topServices', '[]'::jsonb
  );
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
  v_barber := case when public.current_role() = 'coiffeur' then public.current_barber_id() else null end;
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

create or replace function public.admin_agenda(p_date date, p_barber uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barber uuid;
  v_money boolean;
begin
  perform public.assert_staff('agenda');
  v_barber := public.assert_barber_scope(p_barber);
  v_money := public.current_role() = 'proprietaire';
  return (
    select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
      select 'booking' as kind, b.id, b.barber_id as "barberId", br.full_name as "barberName",
        (extract(hour from b.starts_at at time zone 'America/Toronto') * 60 + extract(minute from b.starts_at at time zone 'America/Toronto'))::int as "startMinute",
        (extract(hour from b.ends_at at time zone 'America/Toronto') * 60 + extract(minute from b.ends_at at time zone 'America/Toronto'))::int as "endMinute",
        b.client_name as title, s.name as subtitle, b.status,
        case when v_money then (b.total_cents / 100.0) else null end as "priceLabel",
        (b.status = 'confirme' and b.starts_at <= now()) as "canHonor",
        (public.current_role() = 'proprietaire' and b.status = 'confirme') as "canMove",
        (public.current_role() = 'proprietaire') as "canCancel"
      from public.bookings b
      join public.barbers br on br.id = b.barber_id
      join public.services s on s.id = b.service_id
      where (b.starts_at at time zone 'America/Toronto')::date = p_date
        and b.status not in ('annule', 'annule_tardif')
        and (v_barber is null or b.barber_id = v_barber)
      union all
      select 'block', bs.id, bs.barber_id, br.full_name,
        (extract(hour from bs.starts_at at time zone 'America/Toronto') * 60 + extract(minute from bs.starts_at at time zone 'America/Toronto'))::int,
        (extract(hour from bs.ends_at at time zone 'America/Toronto') * 60 + extract(minute from bs.ends_at at time zone 'America/Toronto'))::int,
        'Bloqué', bs.reason, null, null, false, false, false
      from public.blocked_slots bs
      join public.barbers br on br.id = bs.barber_id
      where (bs.starts_at at time zone 'America/Toronto')::date = p_date
        and (v_barber is null or bs.barber_id = v_barber)
    ) x
  );
end;
$$;

create or replace function public.admin_block(p_barber uuid, p_date date, p_start int, p_end int, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barber uuid;
  v_id uuid := gen_random_uuid();
begin
  perform public.assert_staff('block');
  v_barber := public.assert_barber_scope(p_barber);
  if v_barber is null or p_end <= p_start then
    raise exception 'Créneau invalide.';
  end if;
  insert into public.blocked_slots (id, barber_id, starts_at, ends_at, reason)
  values (
    v_id,
    v_barber,
    (p_date::timestamp + make_interval(mins => p_start)) at time zone 'America/Toronto',
    (p_date::timestamp + make_interval(mins => p_end)) at time zone 'America/Toronto',
    coalesce(nullif(trim(p_reason), ''), 'Indisponible')
  );
  return v_id;
end;
$$;

create or replace function public.admin_unblock(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barber uuid;
begin
  perform public.assert_staff('block');
  select barber_id into v_barber from public.blocked_slots where id = p_id;
  if v_barber is null then
    raise exception 'Blocage introuvable.';
  end if;
  perform public.assert_barber_scope(v_barber);
  delete from public.blocked_slots where id = p_id;
end;
$$;

create or replace function public.admin_honor(p_booking uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
begin
  perform public.assert_staff('honor');
  select * into b from public.bookings where id = p_booking and status = 'confirme';
  if not found or b.starts_at > now() then
    raise exception 'Cette visite ne peut pas être honorée.';
  end if;
  perform public.assert_barber_scope(b.barber_id);
  update public.bookings set status = 'honore' where id = b.id;
  if b.payment_method = 'sur_place' then
    update public.payments set status = 'paye' where booking_id = b.id and status = 'a_encaisser';
  end if;
  if b.client_id is not null and not b.loyalty_redeemed then
    update public.loyalty_accounts
    set points = points + floor(b.price_cents / 100.0),
        stamps = case when stamps + 1 >= 10 then 0 else stamps + 1 end,
        rewards_available = rewards_available + case when stamps + 1 >= 10 then 1 else 0 end
    where client_id = b.client_id;
  end if;
end;
$$;

create or replace function public.admin_move(p_booking uuid, p_date date, p_start int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  v_starts timestamptz;
begin
  perform public.assert_staff('move');
  select * into b from public.bookings where id = p_booking and status = 'confirme';
  if not found then
    raise exception 'Ce rendez-vous ne peut pas être déplacé.';
  end if;
  v_starts := (p_date::timestamp + make_interval(mins => p_start)) at time zone 'America/Toronto';
  update public.bookings
  set starts_at = v_starts, ends_at = v_starts + make_interval(mins => b.duration_minutes)
  where id = b.id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'deplacement', 'booking', b.id::text, jsonb_build_object('date', p_date, 'start', p_start));
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
  select onsite_late_policy into v_policy from public.salon_settings where id = 1;
  if v_within and v_paid then
    v_fee_dollars := round((b.price_cents::numeric / 100) * 0.5, 2);
    v_fee := (v_fee_dollars * 100)::int;
    v_gst := round(round(v_fee_dollars * 100 / 105, 2) * 0.05, 2);
    v_qst := round(round(v_fee_dollars * 100 / 109.975, 2) * 0.09975, 2);
    v_refund := b.total_cents - v_fee;
    update public.bookings set status = 'annule_tardif', cancelled_at = now(), loyalty_redeemed = false where id = b.id;
    update public.payments
    set status = 'rembourse_partiel', refunded_cents = v_refund, fee_cents = v_fee,
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
    set status = case when v_paid then 'rembourse'::public.payment_status else 'echoue'::public.payment_status end,
        refunded_cents = v_refund, fee_cents = 0
    where booking_id = b.id;
  end if;
  if b.loyalty_redeemed and b.client_id is not null then
    update public.loyalty_accounts set rewards_available = rewards_available + 1 where client_id = b.client_id;
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'annulation', 'booking', b.id::text, jsonb_build_object('feeCents', v_fee, 'owingCents', v_owing, 'client', b.client_name));
end;
$$;

create or replace function public.admin_payments(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('payments');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'bookingId', b.id,
      'date', (b.starts_at at time zone 'America/Toronto')::date,
      'clientName', b.client_name,
      'label', s.name,
      'method', b.payment_method,
      'status', p.status,
      'amountCents', b.total_cents,
      'feeCents', p.fee_cents,
      'refundedCents', p.refunded_cents,
      'feeRefunded', p.fee_cents = 0 and p.status = 'rembourse'
    )), '[]'::jsonb)
    from public.bookings b
    join public.payments p on p.booking_id = b.id
    join public.services s on s.id = b.service_id
    where (b.starts_at at time zone 'America/Toronto')::date between p_from and p_to
  );
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
begin
  perform public.assert_staff('refund');
  select fee_cents, (select client_name from public.bookings where id = p_booking) into v_fee, v_name
  from public.payments where booking_id = p_booking;
  if coalesce(v_fee, 0) <= 0 then
    raise exception 'Aucun frais à rembourser.';
  end if;
  update public.payments
  set refunded_cents = refunded_cents + fee_cents, fee_cents = 0, fee_gst_cents = 0, fee_qst_cents = 0, fee_ht_cents = 0, status = 'rembourse'
  where booking_id = p_booking;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'remboursement_frais', 'booking', p_booking::text, jsonb_build_object('feeCents', v_fee, 'client', v_name));
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
  v_barber := case when public.current_role() = 'coiffeur' then public.current_barber_id() else null end;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', coalesce(b.client_id::text, b.client_name),
      'name', b.client_name,
      'visits', count(*) filter (where b.status = 'honore'),
      'note', coalesce((select note from public.client_notes n where n.client_key = coalesce(b.client_id::text, b.client_name)), ''),
      'points', case when v_money then max(l.points) else null end,
      'stamps', case when v_money then max(l.stamps) else null end,
      'spentHtCents', case when v_money then sum(b.price_cents) filter (where b.status = 'honore') else null end,
      'history', '[]'::jsonb
    )), '[]'::jsonb)
    from public.bookings b
    left join public.loyalty_accounts l on l.client_id = b.client_id
    where v_barber is null or b.barber_id = v_barber
    group by b.client_id, b.client_name
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
    select 1 from public.bookings where barber_id = public.current_barber_id() and coalesce(client_id::text, client_name) = p_client
  ) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  insert into public.client_notes (client_key, note, updated_by) values (p_client, trim(p_note), auth.uid())
  on conflict (client_key) do update set note = excluded.note, updated_by = excluded.updated_by;
end;
$$;

create or replace function public.admin_reviews()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('reviewsRead');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'barberId', r.barber_id, 'serviceId', r.service_id, 'clientName', r.client_name,
      'serviceName', coalesce(s.name, ''), 'stars', r.stars, 'body', r.body, 'status', r.status, 'date', r.created_at::date
    )), '[]'::jsonb)
    from public.reviews r
    left join public.services s on s.id = r.service_id
    where public.current_role() = 'proprietaire'
       or (r.barber_id = public.current_barber_id() and r.status = 'publie')
  );
end;
$$;

create or replace function public.admin_moderate_review(p_id uuid, p_status public.review_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('reviewsModerate');
  update public.reviews set status = p_status where id = p_id;
end;
$$;

create or replace function public.admin_promos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('promos');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'code', code,
      'discountType', case when discount_type = 'percent' then 'percent' else 'amount' end,
      'value', case when discount_type = 'percent' then value else value * 100 end,
      'startsOn', starts_on, 'endsOn', ends_on, 'usageLimit', usage_limit, 'usageCount', usage_count, 'active', true
    )), '[]'::jsonb)
    from public.promo_codes
  );
end;
$$;

create or replace function public.admin_save_promo(p_promo jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('promos');
  insert into public.promo_codes (code, discount_type, value, starts_on, ends_on, usage_limit, usage_count)
  values (
    p_promo->>'code',
    case when p_promo->>'discountType' = 'percent' then 'percent' else 'amount' end,
    case when p_promo->>'discountType' = 'percent' then (p_promo->>'value')::numeric else (p_promo->>'value')::numeric / 100 end,
    (p_promo->>'startsOn')::date,
    (p_promo->>'endsOn')::date,
    nullif(p_promo->>'usageLimit', '')::int,
    coalesce((p_promo->>'usageCount')::int, 0)
  )
  on conflict (code) do update set
    discount_type = excluded.discount_type,
    value = excluded.value,
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    usage_limit = excluded.usage_limit;
end;
$$;

create or replace function public.admin_team()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('team');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'fullName', full_name, 'email', '', 'role', role, 'barberId', barber_id, 'active', active
    )), '[]'::jsonb)
    from public.profiles
    where role <> 'client'
  );
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
begin
  perform public.assert_staff('team');
  if p_role = 'client' then
    raise exception 'Accès refusé' using errcode = '42501';
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
  update public.profiles set active = p_active where id = p_user;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), case when p_active then 'reactivation' else 'desactivation' end, 'profile', p_user::text, '{}'::jsonb);
end;
$$;

create or replace function public.admin_invite(p_email text, p_name text, p_role public.user_role, p_barber uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('team');
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'invitation', 'profile', p_email, jsonb_build_object('name', p_name, 'role', p_role, 'barberId', p_barber));
  return jsonb_build_object('password', 'nanometre');
end;
$$;

create or replace function public.admin_update_salon(p_open int, p_close int, p_policy text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('settings');
  if p_policy not in ('aucun', 'a_la_prochaine') or p_close <= p_open then
    raise exception 'Réglage invalide.';
  end if;
  update public.salon_settings set open_minute = p_open, close_minute = p_close, onsite_late_policy = p_policy where id = 1;
end;
$$;

create or replace function public.admin_update_service(p_id uuid, p_price int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('services');
  update public.services set price_cents = p_price where id = p_id and p_price >= 0;
end;
$$;

create or replace function public.admin_set_weekday(p_barber uuid, p_weekday int, p_open boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('barbers');
  if p_open then
    insert into public.schedules (barber_id, weekday, start_minute, end_minute)
    values (p_barber, p_weekday, 540, 1140)
    on conflict (barber_id, weekday) do nothing;
  else
    delete from public.schedules where barber_id = p_barber and weekday = p_weekday;
  end if;
end;
$$;

create or replace function public.admin_audit()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('team');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'action', action, 'detail', detail::text, 'at', created_at
    ) order by created_at desc), '[]'::jsonb)
    from public.audit_log
  );
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
  select onsite_late_policy, gst_number, qst_number into v_policy, v_gst_number, v_qst_number from public.salon_settings where id = 1;
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
    if v_within and b.payment_method = 'sur_place' and v_policy = 'a_la_prochaine' then
      v_fee_dollars := round((b.price_cents::numeric / 100) * 0.5, 2);
      v_owing := (v_fee_dollars * 100)::int;
    end if;
    v_refund := case when not v_within and v_paid then b.total_cents else 0 end;
    update public.bookings
    set status = 'annule', cancelled_at = now(), loyalty_redeemed = false, fee_owing_cents = v_owing
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
      'gstNumber', v_gst_number,
      'qstNumber', v_qst_number
    )
  );
  return b.id;
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
    perform public.enqueue_booking_notifications(new.id, 'annulation', 'Rendez-vous annulé', 'Ton rendez-vous a été annulé.');
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

drop trigger if exists bookings_notify on public.bookings;
create trigger bookings_notify
after insert or update of status, starts_at on public.bookings
for each row execute function public.trg_booking_notifications();

create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade
);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;

create or replace function public.set_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or length(trim(p_token)) < 8 then
    raise exception 'Connecte-toi pour continuer.';
  end if;
  insert into public.push_tokens (token, user_id) values (trim(p_token), auth.uid())
  on conflict (token) do update set user_id = excluded.user_id;
end;
$$;

create or replace function public.admin_barber_setup()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('barbers');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'barberId', br.id,
      'weekdays', coalesce((select jsonb_agg(weekday order by weekday) from public.schedules s where s.barber_id = br.id), '[]'::jsonb),
      'serviceIds', coalesce((select jsonb_agg(service_id) from public.barber_services bs where bs.barber_id = br.id), '[]'::jsonb)
    )), '[]'::jsonb)
    from public.barbers br
  );
end;
$$;

create or replace function public.admin_set_service(p_barber uuid, p_service uuid, p_eligible boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('barbers');
  if p_eligible then
    insert into public.barber_services (barber_id, service_id) values (p_barber, p_service)
    on conflict do nothing;
  else
    delete from public.barber_services where barber_id = p_barber and service_id = p_service;
  end if;
end;
$$;

revoke all on function public.assert_staff(text) from public, anon, authenticated;
revoke all on function public.assert_barber_scope(uuid) from public, anon, authenticated;
grant execute on function public.salon_public() to anon, authenticated;
grant execute on function public.validate_promo(text, date, int) to anon, authenticated;
grant execute on function public.apply_promo(uuid, text) to authenticated;
grant execute on function public.set_notification_opt_in(boolean) to authenticated;
grant execute on function public.notification_opt_in() to authenticated;
grant execute on function public.my_notifications() to authenticated;
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
grant execute on function public.set_push_token(text) to authenticated;
grant execute on function public.admin_barber_setup() to authenticated;
grant execute on function public.admin_set_service(uuid, uuid, boolean) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
