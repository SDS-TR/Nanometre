-- Revue du 12 octobre 2026 (Daouda) et horaires du salon.
--
-- 1. Horaires du salon jour par jour (public.salon_hours). Par défaut : 7 jours
--    sur 7, de 0 h à 24 h. Le propriétaire ferme des jours et règle les heures
--    dans Gestion > Horaires (admin_set_salon_hours). create_booking, list_slots
--    et admin_move lisent les heures du jour demandé ; un jour fermé n’a aucun
--    créneau. Les jours de travail d’un coiffeur vont maintenant de dimanche (0)
--    à samedi (6) et s’ajoutent aux heures du salon (intersection).
-- 2. admin_update_service : propriétaire en aal2, search_path vide, journal du
--    prix (ancien et nouveau) qui sert d’historique (admin_service_price_history).
-- 3. admin_update_service_details : nom, description et durée d’une prestation.
--    Les rendez-vous déjà pris gardent leur durée.
-- 4. admin_reassign_barber_bookings : passe les rendez-vous à venir d’une chaise
--    à une autre quand l’autre coiffeur fait la prestation, travaille ce jour-là
--    et a le créneau libre. Les autres restent ; le client est avisé.
-- 5. admin_dashboard : période « 30j », statistiques par coiffeur (coupes,
--    annulations, occupation, revenu HT) et prestations les plus demandées.
--
-- Toutes les fonctions : RPC seulement, SECURITY DEFINER, search_path vide,
-- noms qualifiés, propriétaire en aal2 (assert_owner / assert_staff), journal.
-- Ordre des verrous inchangé : chaise(s) triées par id, puis prestation, puis
-- rendez-vous, puis jour de salon_hours (FOR SHARE). admin_set_salon_hours verrouille
-- salon_settings puis les 7 lignes de salon_hours (FOR UPDATE) avant de chercher les conflits.

create table if not exists public.salon_hours (
  weekday int primary key check (weekday between 0 and 6),
  is_open boolean not null default true,
  open_minute int not null default 0,
  close_minute int not null default 1440,
  check (open_minute >= 0 and close_minute <= 1440 and open_minute % 15 = 0 and close_minute % 15 = 0),
  check (not is_open or close_minute > open_minute)
);

alter table public.salon_hours enable row level security;
revoke all on table public.salon_hours from public, anon, authenticated;

-- DEFAULT_SALON_HOURS : défaut voulu par Daouda (12 octobre 2026), 7 jours sur 7,
-- 00:00 à 24:00 (0 à 1440 minutes). Pour changer le défaut, modifier CES valeurs et
-- DEFAULT_SALON_DAY dans src/domain/salonWeek.ts. Les créneaux restent bornés par
-- schedules.start_minute / end_minute de chaque coiffeur (heures du salon ∩ coiffeur).
insert into public.salon_hours (weekday, is_open, open_minute, close_minute)
select d, true, 0, 1440 from generate_series(0, 6) d
on conflict (weekday) do nothing;


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
    'minAppVersion', min_app_version,
    'week', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'weekday', h.weekday, 'open', h.is_open, 'openMinute', h.open_minute, 'closeMinute', h.close_minute
      ) order by h.weekday), '[]'::jsonb)
      from public.salon_hours h
    )
  ))
  from public.salon_settings
  where id = 1
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
  v_sched_from int;
  v_sched_to int;
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
  -- F-3 : lue après le verrou de la chaise et verrouillée (FOR SHARE) : une modification
  -- concurrente de la fiche attend la fin de la réservation, ou la réservation lit la nouvelle valeur.
  select duration_minutes, price_cents into v_duration, v_price
  from public.services where id = p_service_id and active for share;
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
  v_dow := extract(dow from p_date)::int;
  -- M-1 : ligne du jour relue après le verrou de la chaise, en FOR SHARE :
  -- admin_set_salon_hours (FOR UPDATE) ne peut pas la changer avant notre commit.
  select case when h.is_open then h.open_minute end, case when h.is_open then h.close_minute end
    into v_open, v_close
  from public.salon_hours h where h.weekday = v_dow for share;
  v_occupancy := public.occupancy_minutes(v_duration);
  select s.start_minute, s.end_minute into v_sched_from, v_sched_to
  from public.schedules s where s.barber_id = p_barber_id and s.weekday = v_dow;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Ce coiffeur ne travaille pas ce jour-là.');
  end if;
  -- Jour fermé : greatest/least ignorent les null, on refuse avant l’intersection.
  if v_open is null then
    return jsonb_build_object('ok', false, 'error', 'Créneau invalide.');
  end if;
  -- Heures du salon ∩ heures du coiffeur.
  v_open := greatest(v_open, v_sched_from);
  v_close := least(v_close, v_sched_to);
  if v_open is null or p_start_minute < v_open or p_start_minute % 15 <> 0 or p_start_minute + v_occupancy > v_close then
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

create or replace function public.list_slots(p_service_id uuid, p_date date, p_barber_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_duration int;
  v_occupancy int;
  v_dow int;
  v_open int;
  v_close int;
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
  select h.open_minute, h.close_minute into v_open, v_close from public.salon_hours h where h.weekday = extract(dow from p_date)::int and h.is_open;
  if v_open is null or v_close is null then
    return '[]'::jsonb;
  end if;
  -- create_booking exige un départ sur la grille de 15 min à partir de minuit.
  v_start := ((v_open + 14) / 15) * 15;
  v_last := v_close - v_occupancy;
  while v_start <= v_last loop
    v_available := false;
    v_assigned := null;
    v_slot_start := (p_date::timestamp + make_interval(mins => v_start)) at time zone 'America/Toronto';
    if v_slot_start > now() then
      for v_barber in
        select b.id
        from public.barbers b
        join public.barber_services bs on bs.barber_id = b.id and bs.service_id = p_service_id
        where b.active
          and (p_barber_id is null or b.id = p_barber_id)
          and exists (
            select 1 from public.schedules sc
            where sc.barber_id = b.id and sc.weekday = v_dow
              and sc.start_minute <= v_start and v_start + v_occupancy <= sc.end_minute
          )
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

create or replace function public.admin_move(p_booking uuid, p_date date, p_start integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  v_barber uuid;
  v_open int;
  v_close int;
  v_sched_from int;
  v_sched_to int;
  v_dow int;
  v_occupancy int;
  v_starts timestamptz;
begin
  perform public.assert_staff('move');
  select barber_id into v_barber from public.bookings where id = p_booking;
  if not found then
    raise exception 'Ce rendez-vous ne peut pas être déplacé.';
  end if;
  -- Même ordre que create_booking et admin_archive_barber : chaise, puis rendez-vous.
  perform 1 from public.barbers where id = v_barber for update;
  select * into b from public.bookings where id = p_booking and status = 'confirme' for update;
  if not found or b.barber_id is distinct from v_barber then
    raise exception 'Ce rendez-vous ne peut pas être déplacé.';
  end if;
  if p_date is null or p_start is null or p_start < 0 or p_start % 15 <> 0 then
    raise exception 'Heure invalide.';
  end if;
  if not exists (select 1 from public.barbers where id = b.barber_id and active) then
    raise exception 'Ce coiffeur est retiré.';
  end if;
  if not exists (select 1 from public.services where id = b.service_id and active) then
    raise exception 'Cette prestation est retirée.';
  end if;
  v_dow := extract(dow from p_date)::int;
  -- M-1 : relue après les verrous (chaise, rendez-vous), en FOR SHARE.
  select case when h.is_open then h.open_minute end, case when h.is_open then h.close_minute end
    into v_open, v_close
  from public.salon_hours h where h.weekday = v_dow for share;
  v_occupancy := public.occupancy_minutes(b.duration_minutes);
  if v_open is null then
    raise exception 'Le salon est fermé ce jour-là.';
  end if;
  select s.start_minute, s.end_minute into v_sched_from, v_sched_to
  from public.schedules s where s.barber_id = b.barber_id and s.weekday = v_dow;
  if not found then
    raise exception 'Ce coiffeur ne travaille pas ce jour-là.';
  end if;
  v_open := greatest(v_open, v_sched_from);
  v_close := least(v_close, v_sched_to);
  if p_start < v_open or p_start + v_occupancy > v_close then
    raise exception 'Ce créneau est hors des heures d’ouverture.';
  end if;
  if not exists (
    select 1 from public.barber_services bs
    where bs.barber_id = b.barber_id and bs.service_id = b.service_id
  ) then
    raise exception 'Ce coiffeur ne fait pas cette prestation.';
  end if;
  v_starts := (p_date::timestamp + make_interval(mins => p_start)) at time zone 'America/Toronto';
  if v_starts <= now() then
    raise exception 'Ce créneau est déjà passé.';
  end if;
  if exists (
    select 1 from public.bookings bk
    where bk.id <> b.id
      and bk.barber_id = b.barber_id
      and bk.status in ('en_attente_paiement', 'confirme', 'honore')
      and tstzrange(bk.starts_at, bk.starts_at + make_interval(mins => public.occupancy_minutes(bk.duration_minutes)), '[)')
        && tstzrange(v_starts, v_starts + make_interval(mins => v_occupancy), '[)')
  ) or exists (
    select 1 from public.blocked_slots s
    where s.barber_id = b.barber_id
      and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(v_starts, v_starts + make_interval(mins => v_occupancy), '[)')
  ) then
    raise exception 'Ce créneau n’est pas libre.';
  end if;
  update public.bookings
  set starts_at = v_starts, ends_at = v_starts + make_interval(mins => b.duration_minutes)
  where id = b.id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'deplacement', 'booking', b.id::text, jsonb_build_object('date', p_date, 'start', p_start));
end;
$$;

create or replace function public.admin_set_weekday(p_barber uuid, p_weekday int, p_open boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_short text;
  v_active boolean;
  v_upcoming int;
  v_days text[] := array['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
begin
  perform public.assert_owner('barbers');
  if p_weekday is null or p_weekday < 0 or p_weekday > 6 or p_open is null then
    raise exception 'Choisis un jour de la semaine.';
  end if;
  -- Même verrou que create_booking : pas de réservation glissée pendant le changement.
  select short_name, active into v_short, v_active from public.barbers where id = p_barber for update;
  if not found then
    raise exception 'Coiffeur introuvable.';
  end if;
  if p_open then
    if exists (select 1 from public.schedules where barber_id = p_barber and weekday = p_weekday) then
      return;
    end if;
    insert into public.schedules (barber_id, weekday, start_minute, end_minute)
    values (p_barber, p_weekday, 0, 1440)
    on conflict (barber_id, weekday) do nothing;
  else
    if not exists (select 1 from public.schedules where barber_id = p_barber and weekday = p_weekday) then
      return;
    end if;
    if v_active and not exists (
      select 1 from public.schedules
      where barber_id = p_barber and weekday <> p_weekday and weekday between 0 and 6
    ) then
      raise exception '% doit garder au moins un jour de travail.', v_short;
    end if;
    select count(*) into v_upcoming from public.bookings
    where barber_id = p_barber
      and status in ('en_attente_paiement', 'confirme')
      and ends_at > now()
      and extract(dow from starts_at at time zone 'America/Toronto')::int = p_weekday;
    if v_upcoming > 0 then
      raise exception '% a encore % rendez-vous à venir le %. Déplace-les ou annule-les dans l’agenda, puis réessaie.',
        v_short, v_upcoming, v_days[p_weekday + 1];
    end if;
    delete from public.schedules where barber_id = p_barber and weekday = p_weekday;
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'coiffeur_jour', 'barber', p_barber::text,
    jsonb_build_object('jour', p_weekday, 'travaille', p_open));
end;
$$;

create or replace function public.admin_reactivate_barber(p_barber uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_short text;
  v_active boolean;
begin
  perform public.assert_owner('barbers');
  -- Même verrou que admin_set_service et admin_archive_service.
  select full_name, short_name, active into v_name, v_short, v_active from public.barbers where id = p_barber for update;
  if not found then
    raise exception 'Coiffeur introuvable.';
  end if;
  if v_active then
    raise exception 'Ce coiffeur est déjà actif.';
  end if;
  if not exists (
    select 1 from public.barber_services bs
    join public.services s on s.id = bs.service_id
    where bs.barber_id = p_barber and s.active
  ) then
    raise exception '% n’offre plus aucune prestation active. Choisis-lui au moins une prestation, puis réactive-le.', v_short;
  end if;
  if not exists (select 1 from public.schedules where barber_id = p_barber and weekday between 0 and 6) then
    raise exception '% n’a aucun jour de travail. Ajoute-lui un jour, puis réactive-le.', v_short;
  end if;
  update public.barbers set active = true where id = p_barber;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'coiffeur_reactivation', 'barber', p_barber::text, jsonb_build_object('nom', v_name));
end;
$$;

create or replace function public.admin_create_barber(
  p_full_name text,
  p_short_name text,
  p_specialty text,
  p_weekdays int[],
  p_service_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_full text := trim(coalesce(p_full_name, ''));
  v_short text := trim(coalesce(p_short_name, ''));
  v_specialty text := nullif(trim(coalesce(p_specialty, '')), '');
  v_days int[];
  v_services uuid[];
begin
  perform public.assert_owner('barbers');
  if length(v_full) < 2 or length(v_full) > 80 then
    raise exception 'Indique le nom complet (2 à 80 caractères).';
  end if;
  if length(v_short) < 1 or length(v_short) > 30 then
    raise exception 'Indique le prénom affiché (30 caractères au plus).';
  end if;
  if v_specialty is not null and length(v_specialty) > 80 then
    raise exception 'La spécialité est trop longue (80 caractères au plus).';
  end if;
  select array_agg(distinct d order by d) into v_days from unnest(coalesce(p_weekdays, '{}'::int[])) d;
  if v_days is null or exists (select 1 from unnest(v_days) d where d < 0 or d > 6) then
    raise exception 'Choisis au moins un jour de travail.';
  end if;
  select array_agg(distinct s.id) into v_services
  from public.services s
  where s.id = any(coalesce(p_service_ids, '{}'::uuid[])) and s.active;
  if v_services is null or cardinality(v_services) <> (select count(distinct x) from unnest(p_service_ids) x) then
    raise exception 'Choisis au moins une prestation offerte.';
  end if;
  insert into public.barbers (id, slug, full_name, short_name, specialty, bio, years, photo_path, sort_order, active)
  values (
    v_id,
    public.catalogue_slug('barbers', v_full),
    v_full,
    v_short,
    coalesce(v_specialty, 'Coiffeur'),
    v_short || ' fait partie de l’équipe du Nanomètre.',
    0,
    '',
    coalesce((select max(sort_order) from public.barbers), 0) + 1,
    true
  );
  insert into public.schedules (barber_id, weekday, start_minute, end_minute)
  select v_id, d, 0, 1440 from unnest(v_days) d;
  insert into public.barber_services (barber_id, service_id)
  select v_id, s from unnest(v_services) s;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'coiffeur_ajout', 'barber', v_id::text, jsonb_build_object('nom', v_full));
  return v_id;
end;
$$;

-- 1. Horaires du salon. p_week : 7 objets { weekday, open, openMinute, closeMinute }.
create or replace function public.admin_set_salon_hours(p_week jsonb, p_force boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day jsonb;
  v_weekday int;
  v_open boolean;
  v_from int;
  v_to int;
  v_seen int[] := '{}';
  v_conflicts text;
  v_ids uuid[];
  v_count int;
  v_id uuid;
begin
  perform public.assert_owner('settings');
  if p_week is null or jsonb_typeof(p_week) <> 'array' or jsonb_array_length(p_week) <> 7 then
    raise exception 'Réglage invalide.';
  end if;
  -- Même ligne que admin_update_salon : un seul réglage d’heures à la fois.
  perform 1 from public.salon_settings where id = 1 for update;
  -- M-1 : les 7 jours, triés, verrouillés AVANT la vérification des conflits.
  -- create_booking et admin_move relisent leur jour en FOR SHARE : soit ils ont
  -- fini (leur rendez-vous est vu ci-dessous), soit ils attendent et lisent les nouvelles heures.
  perform 1 from public.salon_hours order by weekday for update;
  create temporary table if not exists pg_temp.next_hours (weekday int primary key, is_open boolean, open_minute int, close_minute int) on commit drop;
  delete from pg_temp.next_hours;
  for v_day in select value from jsonb_array_elements(p_week) loop
    begin
      v_weekday := (v_day->>'weekday')::int;
      v_open := (v_day->>'open')::boolean;
      v_from := (v_day->>'openMinute')::int;
      v_to := (v_day->>'closeMinute')::int;
    exception when others then
      raise exception 'Réglage invalide.';
    end;
    if v_weekday is null or v_weekday < 0 or v_weekday > 6 or v_weekday = any(v_seen) or v_open is null
      or v_from is null or v_to is null or v_from < 0 or v_to > 1440 or v_from % 15 <> 0 or v_to % 15 <> 0 then
      raise exception 'Réglage invalide.';
    end if;
    if v_open and v_to <= v_from then
      raise exception 'L’heure de fermeture doit suivre l’heure d’ouverture.';
    end if;
    v_seen := v_seen || v_weekday;
    insert into pg_temp.next_hours values (v_weekday, v_open, v_from, v_to);
  end loop;
  if not exists (select 1 from pg_temp.next_hours where is_open) then
    raise exception 'Le salon doit ouvrir au moins un jour.';
  end if;
  -- Rendez-vous à venir qui sortiraient des nouvelles heures : identifiants seulement.
  -- F-1 : total réel ; le message ne liste que les 8 premiers.
  select coalesce(array_agg(x.id order by x.starts_at), '{}') into v_ids from (
    select b.id, b.starts_at
    from public.bookings b
    join pg_temp.next_hours h on h.weekday = extract(dow from b.starts_at at time zone 'America/Toronto')::int
    where b.status in ('en_attente_paiement', 'confirme')
      and b.starts_at > now()
      and (
        not h.is_open
        or (extract(hour from b.starts_at at time zone 'America/Toronto') * 60 + extract(minute from b.starts_at at time zone 'America/Toronto'))::int < h.open_minute
        or (extract(hour from b.starts_at at time zone 'America/Toronto') * 60 + extract(minute from b.starts_at at time zone 'America/Toronto'))::int + b.duration_minutes > h.close_minute
      )
  ) x;
  v_count := coalesce(array_length(v_ids, 1), 0);
  select string_agg(i::text, ', ' order by o) into v_conflicts
  from unnest(v_ids[1:8]) with ordinality as u(i, o);
  if v_count > 0 and not coalesce(p_force, false) then
    raise exception 'Ces rendez-vous à venir sortent des nouvelles heures (%). Identifiants : %.', v_count, v_conflicts;
  end if;
  insert into public.salon_hours (weekday, is_open, open_minute, close_minute)
  select weekday, is_open, open_minute, close_minute from pg_temp.next_hours
  on conflict (weekday) do update set
    is_open = excluded.is_open,
    open_minute = excluded.open_minute,
    close_minute = excluded.close_minute;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'salon_horaires', 'salon', '1', jsonb_build_object(
    'semaine', (select jsonb_agg(jsonb_build_object('jour', weekday, 'ouvert', is_open, 'ouverture', open_minute, 'fermeture', close_minute) order by weekday) from pg_temp.next_hours),
    'force', coalesce(p_force, false) and v_count > 0,
    'conflits', v_count,
    'ids', to_jsonb(v_ids)
  ));
  -- F-2 : enregistrement forcé, les rendez-vous hors horaires sont maintenus et le client est avisé.
  foreach v_id in array v_ids loop
    perform public.enqueue_booking_notifications(v_id, 'changement', 'Horaires du salon',
      'Le salon a changé ses heures. Ton rendez-vous est maintenu ; on te contactera au besoin.');
  end loop;
end;
$$;

-- 2. Prix : propriétaire aal2, journal = historique.
create or replace function public.admin_update_service(p_id uuid, p_price int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_old int;
begin
  perform public.assert_owner('services');
  if p_price is null or p_price <= 0 or p_price > 100000 then
    raise exception 'Tarif invalide.';
  end if;
  select name, price_cents into v_name, v_old from public.services where id = p_id for update;
  if not found then
    raise exception 'Prestation introuvable.';
  end if;
  if v_old = p_price then
    return;
  end if;
  update public.services set price_cents = p_price where id = p_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'prestation_prix', 'service', p_id::text,
    jsonb_build_object('nom', v_name, 'ancien', v_old, 'nouveau', p_price));
end;
$$;

create or replace function public.admin_service_price_history(p_service uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_owner('services');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'at', a.created_at,
      'oldCents', (a.detail->>'ancien')::int,
      'newCents', (a.detail->>'nouveau')::int
    ) order by a.created_at desc), '[]'::jsonb)
    from (
      select id, created_at, detail from public.audit_log
      where action = 'prestation_prix' and entity = 'service' and entity_id = p_service::text
      order by created_at desc
      limit 50
    ) a
  );
end;
$$;

-- 3. Nom, description et durée.
create or replace function public.admin_update_service_details(p_service uuid, p_name text, p_description text, p_duration int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_description text := trim(coalesce(p_description, ''));
  v_old public.services%rowtype;
begin
  perform public.assert_owner('services');
  if length(v_name) < 2 or length(v_name) > 60 then
    raise exception 'Indique le nom de la prestation (2 à 60 caractères).';
  end if;
  if length(v_description) > 240 then
    raise exception 'La description est trop longue (240 caractères au plus).';
  end if;
  if p_duration is null or p_duration < 10 or p_duration > 240 or p_duration % 5 <> 0 then
    raise exception 'Durée invalide (10 à 240 minutes, par pas de 5).';
  end if;
  select * into v_old from public.services where id = p_service for update;
  if not found then
    raise exception 'Prestation introuvable.';
  end if;
  if exists (select 1 from public.services where lower(name) = lower(v_name) and active and id <> p_service) then
    raise exception 'Une prestation porte déjà ce nom.';
  end if;
  if v_old.name = v_name and v_old.description = v_description and v_old.duration_minutes = p_duration then
    return;
  end if;
  update public.services
  set name = v_name, description = v_description, duration_minutes = p_duration
  where id = p_service;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'prestation_modification', 'service', p_service::text, jsonb_build_object(
    'avant', jsonb_build_object('nom', v_old.name, 'duree', v_old.duration_minutes),
    'apres', jsonb_build_object('nom', v_name, 'duree', p_duration),
    'description_modifiee', v_old.description is distinct from v_description
  ));
end;
$$;

-- 4. Réassigner les rendez-vous à venir d’une chaise avant de la retirer.
create or replace function public.admin_reassign_barber_bookings(p_from uuid, p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  v_from_name text;
  v_to_name text;
  v_to_short text;
  v_to_active boolean;
  v_moved int := 0;
  v_kept int := 0;
  v_start int;
  v_window tstzrange;
begin
  perform public.assert_owner('barbers');
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'Choisis un autre coiffeur actif.';
  end if;
  -- Les deux chaises, triées par id : même ordre que create_booking et admin_move.
  perform 1 from public.barbers where id in (p_from, p_to) order by id for update;
  select full_name into v_from_name from public.barbers where id = p_from;
  if not found then
    raise exception 'Coiffeur introuvable.';
  end if;
  select full_name, short_name, active into v_to_name, v_to_short, v_to_active from public.barbers where id = p_to;
  if not found or not v_to_active then
    raise exception 'Choisis un autre coiffeur actif.';
  end if;
  for b in
    select * from public.bookings
    where barber_id = p_from
      and status in ('en_attente_paiement', 'confirme')
      and ends_at > now()
    order by starts_at
    for update
  loop
    v_window := tstzrange(b.starts_at, b.starts_at + make_interval(mins => public.occupancy_minutes(b.duration_minutes)), '[)');
    v_start := (extract(hour from b.starts_at at time zone 'America/Toronto') * 60
      + extract(minute from b.starts_at at time zone 'America/Toronto'))::int;
    if exists (select 1 from public.barber_services bs where bs.barber_id = p_to and bs.service_id = b.service_id)
      -- M-2 : dans les heures de travail du coiffeur cible ET les heures du salon ce jour-là.
      and exists (
        select 1 from public.schedules s
        where s.barber_id = p_to and s.weekday = extract(dow from b.starts_at at time zone 'America/Toronto')::int
          and s.start_minute <= v_start
          and v_start + public.occupancy_minutes(b.duration_minutes) <= s.end_minute
      )
      and exists (
        select 1 from public.salon_hours h
        where h.weekday = extract(dow from b.starts_at at time zone 'America/Toronto')::int
          and h.is_open and h.open_minute <= v_start
          and v_start + public.occupancy_minutes(b.duration_minutes) <= h.close_minute
      )
      and not exists (
        select 1 from public.bookings bk
        where bk.barber_id = p_to
          and bk.status in ('en_attente_paiement', 'confirme', 'honore')
          and tstzrange(bk.starts_at, bk.starts_at + make_interval(mins => public.occupancy_minutes(bk.duration_minutes)), '[)') && v_window
      )
      and not exists (
        select 1 from public.blocked_slots s
        where s.barber_id = p_to and tstzrange(s.starts_at, s.ends_at, '[)') && v_window
      )
    then
      update public.bookings set barber_id = p_to where id = b.id;
      perform public.enqueue_booking_notifications(b.id, 'changement', 'Nouveau coiffeur',
        'Ton rendez-vous sera avec ' || v_to_short || '.');
      v_moved := v_moved + 1;
    else
      v_kept := v_kept + 1;
    end if;
  end loop;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'coiffeur_reassignation', 'barber', p_from::text,
    jsonb_build_object('de', v_from_name, 'vers', v_to_name, 'reassignes', v_moved, 'restants', v_kept));
  return jsonb_build_object('moved', v_moved, 'kept', v_kept);
end;
$$;

-- 5. Tableau : période 30 jours et statistiques par coiffeur.
-- Volatile (table temporaire de travail) ; l’appel RPC passe déjà en POST.
create or replace function public.admin_dashboard(p_anchor date, p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_to date;
  v_capacity int;
  v_chairs int;
  v_busy int;
begin
  perform public.assert_staff('dashboard');
  if p_anchor is null then
    raise exception 'Date invalide.';
  end if;
  if p_period = 'mois' then
    v_from := date_trunc('month', p_anchor)::date;
    v_to := (v_from + interval '1 month' - interval '1 day')::date;
  elsif p_period = 'semaine' then
    v_from := p_anchor - ((extract(dow from p_anchor)::int + 5) % 7);
    v_to := v_from + 4;
  elsif p_period = '30j' then
    v_from := p_anchor - 29;
    v_to := p_anchor;
  else
    v_from := p_anchor;
    v_to := p_anchor;
  end if;
  -- Minutes ouvertes d’une chaise sur la période, selon les horaires du salon.
  select coalesce(sum(h.close_minute - h.open_minute), 0) into v_capacity
  from generate_series(v_from, v_to, interval '1 day') d
  join public.salon_hours h on h.weekday = extract(dow from d)::int and h.is_open;
  v_capacity := greatest(v_capacity, 1);
  create temporary table if not exists pg_temp.dash_rows (barber_id uuid, service_id uuid, status text, duration int, price int, total int) on commit drop;
  delete from pg_temp.dash_rows;
  insert into pg_temp.dash_rows
  select b.barber_id, b.service_id, b.status::text, b.duration_minutes, b.price_cents, b.total_cents
  from public.bookings b
  where (b.starts_at at time zone 'America/Toronto')::date between v_from and v_to;
  select count(*) into v_chairs from public.barbers br
  where br.active or exists (select 1 from pg_temp.dash_rows r where r.barber_id = br.id);
  select coalesce(sum(duration), 0) into v_busy from pg_temp.dash_rows where status in ('honore', 'confirme');
  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'cuts', (select count(*) from pg_temp.dash_rows where status in ('honore', 'confirme')),
    'booked', (select count(*) from pg_temp.dash_rows),
    'cancelled', (select count(*) from pg_temp.dash_rows where status in ('annule', 'annule_tardif')),
    'occupancy', v_busy::numeric / (greatest(v_chairs, 1) * v_capacity),
    'revenueHtCents', (select coalesce(sum(price), 0) from pg_temp.dash_rows where status in ('honore', 'confirme')),
    'revenueTtcCents', (select coalesce(sum(total), 0) from pg_temp.dash_rows where status in ('honore', 'confirme')),
    'perBarber', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', br.full_name,
        'cuts', (select count(*) from pg_temp.dash_rows r where r.barber_id = br.id and r.status in ('honore', 'confirme')),
        'cancelled', (select count(*) from pg_temp.dash_rows r where r.barber_id = br.id and r.status in ('annule', 'annule_tardif')),
        'occupancy', (select coalesce(sum(r.duration), 0) from pg_temp.dash_rows r where r.barber_id = br.id and r.status in ('honore', 'confirme'))::numeric / v_capacity,
        'revenueHtCents', (select coalesce(sum(r.price), 0) from pg_temp.dash_rows r where r.barber_id = br.id and r.status in ('honore', 'confirme'))
      ) order by br.sort_order), '[]'::jsonb)
      from public.barbers br
      where br.active or exists (select 1 from pg_temp.dash_rows r where r.barber_id = br.id)
    ),
    'topServices', (
      select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'count', x.n, 'revenueHtCents', x.revenue) order by x.n desc, x.name), '[]'::jsonb)
      from (
        select s.name, count(*) as n, sum(r.price) as revenue
        from pg_temp.dash_rows r
        join public.services s on s.id = r.service_id
        where r.status in ('honore', 'confirme')
        group by s.name
      ) x
    )
  );
end;
$$;

revoke execute on function public.admin_set_salon_hours(jsonb, boolean) from public, anon;
revoke execute on function public.admin_update_service(uuid, int) from public, anon;
revoke execute on function public.admin_service_price_history(uuid) from public, anon;
revoke execute on function public.admin_update_service_details(uuid, text, text, int) from public, anon;
revoke execute on function public.admin_reassign_barber_bookings(uuid, uuid) from public, anon;
revoke execute on function public.admin_dashboard(date, text) from public, anon;

grant execute on function public.admin_set_salon_hours(jsonb, boolean) to authenticated;
grant execute on function public.admin_update_service(uuid, int) to authenticated;
grant execute on function public.admin_service_price_history(uuid) to authenticated;
grant execute on function public.admin_update_service_details(uuid, text, text, int) to authenticated;
grant execute on function public.admin_reassign_barber_bookings(uuid, uuid) to authenticated;
grant execute on function public.admin_dashboard(date, text) to authenticated;
