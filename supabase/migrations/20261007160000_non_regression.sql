-- Non-régression : create_booking (enums, planning, total nul), heures bornées,
-- plancher de version côté serveur, search_path vide sur les fonctions de la revue.

alter table public.salon_settings
  add column if not exists min_app_version text not null default '1.0.0';

create or replace function public.salon_public()
returns jsonb
language sql
stable
security definer
set search_path = ''
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
    'onsiteLatePolicy', onsite_late_policy,
    'minAppVersion', min_app_version
  ))
  from public.salon_settings
  where id = 1
$$;

create or replace function public.admin_update_salon(p_open int, p_close int, p_policy text, p_force boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
  v_ids text;
begin
  perform public.assert_staff('settings');
  if p_policy not in ('aucun', 'a_la_prochaine')
     or p_open is null or p_close is null
     or p_open < 0 or p_close > 1440
     or p_open % 15 <> 0 or p_close % 15 <> 0
     or p_close <= p_open then
    raise exception 'Réglage invalide.';
  end if;
  select count(*)::int, string_agg(id::text, ', ')
  into v_count, v_ids
  from (
    select id
    from public.bookings
    where status in ('confirme', 'en_attente_paiement', 'honore')
      and starts_at > now()
      and (
        (extract(hour from starts_at at time zone 'America/Toronto') * 60 + extract(minute from starts_at at time zone 'America/Toronto')) < p_open
        or (extract(hour from starts_at at time zone 'America/Toronto') * 60 + extract(minute from starts_at at time zone 'America/Toronto') + duration_minutes) > p_close
      )
    limit 8
  ) upcoming;
  if v_count > 0 and not coalesce(p_force, false) then
    raise exception 'Ces rendez-vous à venir sortent des nouvelles heures (%). Identifiants : %.', v_count, v_ids;
  end if;
  update public.salon_settings set open_minute = p_open, close_minute = p_close, onsite_late_policy = p_policy where id = 1;
end;
$$;

create or replace function public.create_booking(
  p_service_id uuid,
  p_barber_id uuid,
  p_date date,
  p_start_minute int,
  p_method public.payment_method,
  p_redeem boolean,
  p_promo text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_duration int;
  v_price int;
  v_open int;
  v_close int;
  v_occupancy int;
  v_dow int;
  v_starts timestamptz;
  v_gst int;
  v_qst int;
  v_total int;
  v_id uuid := gen_random_uuid();
  v_rewards int;
  v_quote jsonb;
  v_discount int := 0;
  v_code text;
  v_booking_status public.booking_status;
  v_payment_status public.payment_status;
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
  if not exists (select 1 from public.barbers where id = p_barber_id and active) then
    return jsonb_build_object('ok', false, 'error', 'Ce coiffeur est inactif.');
  end if;
  if not exists (
    select 1 from public.barber_services where barber_id = p_barber_id and service_id = p_service_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'Ce coiffeur ne fait pas cette prestation.');
  end if;
  select open_minute, close_minute into v_open, v_close from public.salon_settings where id = 1;
  v_dow := extract(dow from p_date)::int;
  v_occupancy := public.occupancy_minutes(v_duration);
  if not exists (
    select 1 from public.schedules s where s.barber_id = p_barber_id and s.weekday = v_dow
  ) then
    return jsonb_build_object('ok', false, 'error', 'Ce coiffeur ne travaille pas ce jour-là.');
  end if;
  if v_dow < 2 or v_dow > 6 or p_start_minute < v_open or p_start_minute % 15 <> 0 or p_start_minute + v_occupancy > v_close then
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
  if not p_redeem and p_promo is not null and length(trim(p_promo)) > 0 then
    if exists (select 1 from public.promo_redemptions where client_id = v_user and code = upper(trim(p_promo))) then
      return jsonb_build_object('ok', false, 'error', 'Tu as déjà utilisé ce code.');
    end if;
    perform 1 from public.promo_codes where upper(code) = upper(trim(p_promo)) for update;
    v_quote := public.validate_promo(p_promo, p_date, v_price);
    if coalesce((v_quote->>'ok')::boolean, false) is not true then
      return jsonb_build_object('ok', false, 'error', coalesce(v_quote->>'error', 'Ce code n’est pas reconnu.'));
    end if;
    v_discount := (v_quote->>'discountCents')::int;
    v_code := v_quote->>'code';
    v_price := greatest(0, v_price - v_discount);
  end if;
  if p_redeem then
    select rewards_available into v_rewards from public.loyalty_accounts where client_id = v_user for update;
    if coalesce(v_rewards, 0) < 1 then
      return jsonb_build_object('ok', false, 'error', 'Aucune coupe offerte à utiliser.');
    end if;
    update public.loyalty_accounts set rewards_available = rewards_available - 1 where client_id = v_user;
    v_price := 0;
    v_discount := 0;
    v_code := null;
  end if;
  select gst_cents, qst_cents, total_cents into v_gst, v_qst, v_total from public.line_taxes(v_price);
  if v_total = 0 or p_method <> 'en_ligne' then
    v_booking_status := 'confirme'::public.booking_status;
    v_payment_status := 'a_encaisser'::public.payment_status;
  else
    v_booking_status := 'en_attente_paiement'::public.booking_status;
    v_payment_status := 'en_attente'::public.payment_status;
  end if;
  insert into public.bookings (
    id, client_id, client_name, barber_id, service_id, starts_at, ends_at, duration_minutes,
    price_cents, gst_cents, qst_cents, total_cents, payment_method, status, loyalty_redeemed,
    promo_code, discount_cents
  ) values (
    v_id, v_user, v_name, p_barber_id, p_service_id, v_starts, v_starts + make_interval(mins => v_duration), v_duration,
    v_price, v_gst, v_qst, v_total, p_method,
    v_booking_status,
    p_redeem, v_code, v_discount
  );
  insert into public.payments (booking_id, method, status, amount_cents)
  values (v_id, p_method, v_payment_status, v_total);
  if v_code is not null then
    insert into public.promo_redemptions (booking_id, client_id, code) values (v_id, v_user, v_code);
    update public.promo_codes set usage_count = usage_count + 1 where code = v_code;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'totalCents', v_total);
end;
$$;

create or replace function public.set_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or length(trim(p_token)) < 8 then
    raise exception 'Connecte-toi pour continuer.';
  end if;
  insert into public.push_tokens (token, user_id) values (trim(p_token), auth.uid())
  on conflict (token) do update set user_id = excluded.user_id;
end;
$$;

-- Fonctions de la revue : noms déjà qualifiés, search_path vide (guide § 7.4).
alter function public.admin_move(uuid, date, int) set search_path = '';
alter function public.admin_agenda(date, uuid) set search_path = '';
alter function public.admin_update_service(uuid, int) set search_path = '';
alter function public.admin_save_promo(jsonb) set search_path = '';
alter function public.admin_promos() set search_path = '';
alter function public.validate_promo(text, date, int) set search_path = '';
alter function public.visible_barbers() set search_path = '';

grant execute on function public.salon_public() to anon, authenticated;
grant execute on function public.admin_update_salon(int, int, text, boolean) to authenticated;
grant execute on function public.create_booking(uuid, uuid, date, int, public.payment_method, boolean, text) to authenticated;
grant execute on function public.set_push_token(text) to authenticated;
