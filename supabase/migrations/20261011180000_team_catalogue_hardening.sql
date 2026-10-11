-- Durcissement de la gestion de l’équipe et du catalogue (revue de 07edaab).
-- M-1 admin_move verrouille la chaise. M-2 list_slots lit les heures du salon.
-- F-1 pas de compte coiffeur actif sur une chaise retirée. F-2 une chaise réactivée
-- garde au moins une prestation active et un jour. F-3 admin_set_weekday borné.
-- F-4 admin_set_service verrouille la chaise. F-5 plafond d’invitations (KEY-12).
-- Toutes les fonctions : SECURITY DEFINER, search_path vide, noms qualifiés.

-- F-5 : tentatives d’invitation, comptées côté serveur par propriétaire.
create table if not exists public.invite_attempts (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists invite_attempts_owner_created_idx on public.invite_attempts (owner_id, created_at desc);
alter table public.invite_attempts enable row level security;
revoke all on table public.invite_attempts from public, anon, authenticated;

-- Réservé à l’Edge Function (clé de service). Compte la tentative et répond false
-- au-delà de 10 invitations par propriétaire sur une heure glissante.
create or replace function public.claim_invite_attempt(p_owner uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent int;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_owner is null then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  -- Deux invitations simultanées du même propriétaire passent l’une après l’autre.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invite:' || p_owner::text, 0));
  delete from public.invite_attempts where created_at < now() - interval '1 day';
  select count(*) into v_recent from public.invite_attempts
  where owner_id = p_owner and created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (p_owner, 'invitation_plafond', 'profile', p_owner::text, jsonb_build_object('par_heure', 10));
    return false;
  end if;
  insert into public.invite_attempts (owner_id) values (p_owner);
  return true;
end;
$$;

-- F-1 : l’activation à la première connexion n’ouvre pas un compte coiffeur
-- sur une chaise retirée. L’invitation est alors annulée et journalisée.
create or replace function public.activate_invited_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_barber uuid;
begin
  if new.last_sign_in_at is not null and old.last_sign_in_at is distinct from new.last_sign_in_at then
    select role, barber_id into v_role, v_barber
    from public.profiles
    where id = new.id and active = false and invited_at is not null;
    if not found then
      return new;
    end if;
    if v_role = 'coiffeur'::public.user_role and (
      v_barber is null
      or not exists (select 1 from public.barbers b where b.id = v_barber and b.active)
    ) then
      update public.profiles set invited_at = null where id = new.id;
      insert into public.audit_log (action, entity, entity_id, detail)
      values ('activation_bloquee', 'profile', new.id::text, jsonb_build_object('raison', 'chaise_retiree'));
      return new;
    end if;
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

-- F-1 : un membre ne devient pas coiffeur sur une chaise retirée.
create or replace function public.admin_set_role(p_user uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_barber uuid;
begin
  perform public.assert_staff('team');
  if p_role = 'client'::public.user_role then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select barber_id into v_barber from public.profiles where id = p_user;
  if p_role = 'coiffeur'::public.user_role and v_barber is null then
    raise exception 'Choisis la chaise de ce coiffeur.';
  end if;
  if p_role = 'coiffeur'::public.user_role then
    -- Même verrou que l’archivage : la chaise ne se retire pas pendant le changement.
    perform 1 from public.barbers where id = v_barber for update;
    if not exists (select 1 from public.barbers where id = v_barber and active) then
      raise exception 'La chaise de ce coiffeur est retirée. Réactive-la dans Coiffeurs d’abord.';
    end if;
  end if;
  if p_role = 'coiffeur'::public.user_role and exists (
    select 1 from public.profiles where barber_id = v_barber and active and id <> p_user
  ) then
    raise exception 'Cette chaise a déjà un compte actif.';
  end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'proprietaire'::public.user_role and active)
     and p_role <> 'proprietaire'::public.user_role
     and (select count(*) from public.profiles where role = 'proprietaire'::public.user_role and active and id <> p_user) < 1 then
    raise exception 'Il doit rester au moins un propriétaire actif.';
  end if;
  select full_name into v_name from public.profiles where id = p_user;
  update public.profiles set role = p_role where id = p_user and role <> 'client'::public.user_role;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'role', 'profile', p_user::text, jsonb_build_object('role', p_role, 'name', v_name));
end;
$$;

-- F-2 : une chaise réactivée garde au moins une prestation active et un jour.
-- Les prestations d’une chaise retirée se règlent avant avec admin_set_service.
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
  if not exists (select 1 from public.schedules where barber_id = p_barber and weekday between 2 and 6) then
    raise exception '% n’a aucun jour de travail (mardi au samedi). Ajoute-lui un jour, puis réactive-le.', v_short;
  end if;
  update public.barbers set active = true where id = p_barber;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'coiffeur_reactivation', 'barber', p_barber::text, jsonb_build_object('nom', v_name));
end;
$$;

-- F-4 : verrou de chaise, comme create_booking et admin_archive_service.
create or replace function public.admin_set_service(p_barber uuid, p_service uuid, p_eligible boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_staff('barbers');
  perform 1 from public.barbers where id = p_barber for update;
  if not found then
    raise exception 'Coiffeur introuvable.';
  end if;
  if p_eligible then
    if not exists (select 1 from public.services where id = p_service and active) then
      raise exception 'Cette prestation est retirée.';
    end if;
    insert into public.barber_services (barber_id, service_id) values (p_barber, p_service)
    on conflict do nothing;
  else
    if exists (select 1 from public.barbers where id = p_barber and active)
       and not exists (
         select 1 from public.barber_services bs
         join public.services s on s.id = bs.service_id
         where bs.barber_id = p_barber and s.active and s.id <> p_service
       ) then
      raise exception 'Un coiffeur actif doit garder au moins une prestation.';
    end if;
    delete from public.barber_services where barber_id = p_barber and service_id = p_service;
  end if;
end;
$$;

-- F-3 : jours bornés au mardi-samedi, dernier jour gardé, rendez-vous à venir protégés.
create or replace function public.admin_set_weekday(p_barber uuid, p_weekday int, p_open boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_short text;
  v_active boolean;
  v_open int;
  v_close int;
  v_upcoming int;
  v_days text[] := array['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
begin
  perform public.assert_owner('barbers');
  if p_weekday is null or p_weekday < 2 or p_weekday > 6 or p_open is null then
    raise exception 'Choisis un jour d’ouverture du salon (mardi au samedi).';
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
    select open_minute, close_minute into v_open, v_close from public.salon_settings where id = 1;
    insert into public.schedules (barber_id, weekday, start_minute, end_minute)
    values (p_barber, p_weekday, coalesce(v_open, 540), coalesce(v_close, 1140))
    on conflict (barber_id, weekday) do nothing;
  else
    if not exists (select 1 from public.schedules where barber_id = p_barber and weekday = p_weekday) then
      return;
    end if;
    if v_active and not exists (
      select 1 from public.schedules
      where barber_id = p_barber and weekday <> p_weekday and weekday between 2 and 6
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

-- M-1 : verrou de chaise puis du rendez-vous avant les contrôles « actif ».
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
  select open_minute, close_minute into v_open, v_close from public.salon_settings where id = 1;
  v_dow := extract(dow from p_date)::int;
  v_occupancy := public.occupancy_minutes(b.duration_minutes);
  if v_dow < 2 or v_dow > 6 then
    raise exception 'Le salon est fermé ce jour-là.';
  end if;
  if not exists (
    select 1 from public.schedules s where s.barber_id = b.barber_id and s.weekday = v_dow
  ) then
    raise exception 'Ce coiffeur ne travaille pas ce jour-là.';
  end if;
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

-- M-2 : les créneaux suivent les heures du salon, les mêmes que create_booking.
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
  if v_dow < 2 or v_dow > 6 then
    return '[]'::jsonb;
  end if;
  select open_minute, close_minute into v_open, v_close from public.salon_settings where id = 1;
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
          and exists (select 1 from public.schedules sc where sc.barber_id = b.id and sc.weekday = v_dow)
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

revoke execute on function public.claim_invite_attempt(uuid) from public, anon, authenticated;
revoke execute on function public.activate_invited_profile() from public, anon, authenticated;
revoke execute on function public.admin_set_role(uuid, public.user_role) from public, anon;
revoke execute on function public.admin_reactivate_barber(uuid) from public, anon;
revoke execute on function public.admin_set_service(uuid, uuid, boolean) from public, anon;
revoke execute on function public.admin_set_weekday(uuid, int, boolean) from public, anon;
revoke execute on function public.admin_move(uuid, date, int) from public, anon;
revoke execute on function public.list_slots(uuid, date, uuid) from public;

grant execute on function public.claim_invite_attempt(uuid) to service_role;
grant execute on function public.admin_set_role(uuid, public.user_role) to authenticated;
grant execute on function public.admin_reactivate_barber(uuid) to authenticated;
grant execute on function public.admin_set_service(uuid, uuid, boolean) to authenticated;
grant execute on function public.admin_set_weekday(uuid, int, boolean) to authenticated;
grant execute on function public.admin_move(uuid, date, int) to authenticated;
grant execute on function public.list_slots(uuid, date, uuid) to anon, authenticated;
