-- Gestion des chaises et des prestations par le propriétaire.
-- Retirer = archiver (active = false). Rien n’est effacé : réservations, paiements,
-- avis et journal gardent le nom et le prix d’origine.
-- Toutes les fonctions : SECURITY DEFINER, search_path vide, propriétaire seulement
-- (assert_staff exige aal2 pour 'barbers' et 'services'), journalisées.

create or replace function public.catalogue_slug(p_table text, p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_slug text;
  v_n int := 1;
  v_taken boolean;
begin
  v_base := lower(translate(coalesce(p_name, ''),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ’''',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY--'));
  v_base := trim(both '-' from regexp_replace(v_base, '[^a-z0-9]+', '-', 'g'));
  if v_base = '' then
    v_base := 'element';
  end if;
  v_base := left(v_base, 48);
  v_slug := v_base;
  loop
    if p_table = 'barbers' then
      select exists (select 1 from public.barbers where slug = v_slug) into v_taken;
    else
      select exists (select 1 from public.services where slug = v_slug) into v_taken;
    end if;
    exit when not v_taken;
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
end;
$$;

create or replace function public.assert_owner(p_action text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_staff(p_action);
  if public.current_role() is distinct from 'proprietaire'::public.user_role then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
end;
$$;

-- Liste complète pour l’écran Coiffeurs, chaises retirées comprises.
create or replace function public.admin_barbers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_owner('barbers');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', br.id,
      'slug', br.slug,
      'fullName', br.full_name,
      'shortName', br.short_name,
      'specialty', br.specialty,
      'photo', br.photo_path,
      'sortOrder', br.sort_order,
      'active', br.active,
      'weekdays', coalesce((select jsonb_agg(s.weekday order by s.weekday) from public.schedules s where s.barber_id = br.id), '[]'::jsonb),
      'serviceIds', coalesce((select jsonb_agg(bs.service_id) from public.barber_services bs where bs.barber_id = br.id), '[]'::jsonb),
      'upcomingCount', (
        select count(*) from public.bookings bk
        where bk.barber_id = br.id and bk.status in ('en_attente_paiement', 'confirme') and bk.ends_at > now()
      ),
      'accountCount', (
        select count(*) from public.profiles p
        where p.barber_id = br.id and p.role = 'coiffeur' and (p.active or p.invited_at is not null)
      )
    ) order by br.active desc, br.sort_order), '[]'::jsonb)
    from public.barbers br
  );
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
  if v_days is null or exists (select 1 from unnest(v_days) d where d < 2 or d > 6) then
    raise exception 'Choisis au moins un jour d’ouverture (mardi au samedi).';
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
  select v_id, d, 540, 1140 from unnest(v_days) d;
  insert into public.barber_services (barber_id, service_id)
  select v_id, s from unnest(v_services) s;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'coiffeur_ajout', 'barber', v_id::text, jsonb_build_object('nom', v_full));
  return v_id;
end;
$$;

create or replace function public.admin_archive_barber(p_barber uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_active boolean;
  v_upcoming int;
  v_accounts int;
begin
  perform public.assert_owner('barbers');
  -- Même verrou que create_booking : une réservation en cours finit avant le comptage.
  select full_name, active into v_name, v_active from public.barbers where id = p_barber for update;
  if not found then
    raise exception 'Coiffeur introuvable.';
  end if;
  if not v_active then
    raise exception 'Ce coiffeur est déjà retiré.';
  end if;
  if (select count(*) from public.barbers where active and id <> p_barber) < 1 then
    raise exception 'Il doit rester au moins un coiffeur actif.';
  end if;
  select count(*) into v_upcoming from public.bookings
  where barber_id = p_barber and status in ('en_attente_paiement', 'confirme') and ends_at > now();
  if v_upcoming > 0 then
    raise exception '% a encore % rendez-vous à venir. Déplace-les ou annule-les dans l’agenda, puis réessaie.',
      v_name, v_upcoming;
  end if;
  update public.barbers set active = false where id = p_barber;
  -- Les comptes coiffeur liés sont coupés, invitations en attente comprises.
  -- Un compte propriétaire lié à la chaise reste actif.
  with cut as (
    update public.profiles
    set active = false, invited_at = null
    where barber_id = p_barber and role = 'coiffeur' and (active or invited_at is not null)
    returning id
  )
  select count(*) into v_accounts from cut;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'coiffeur_retrait', 'barber', p_barber::text,
    jsonb_build_object('nom', v_name, 'comptes_desactives', v_accounts));
  return jsonb_build_object('deactivatedAccounts', v_accounts);
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
begin
  perform public.assert_owner('barbers');
  update public.barbers set active = true where id = p_barber and not active returning full_name into v_name;
  if v_name is null then
    raise exception 'Ce coiffeur est déjà actif.';
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'coiffeur_reactivation', 'barber', p_barber::text, jsonb_build_object('nom', v_name));
end;
$$;

-- Liste complète pour l’écran Prestations, prestations retirées comprises.
create or replace function public.admin_services()
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
      'id', s.id,
      'slug', s.slug,
      'name', s.name,
      'description', s.description,
      'durationMinutes', s.duration_minutes,
      'priceCents', s.price_cents,
      'photo', s.photo_path,
      'sortOrder', s.sort_order,
      'active', s.active,
      'barberIds', coalesce((select jsonb_agg(bs.barber_id) from public.barber_services bs where bs.service_id = s.id), '[]'::jsonb),
      'upcomingCount', (
        select count(*) from public.bookings bk
        where bk.service_id = s.id and bk.status in ('en_attente_paiement', 'confirme') and bk.ends_at > now()
      )
    ) order by s.active desc, s.sort_order), '[]'::jsonb)
    from public.services s
  );
end;
$$;

create or replace function public.admin_create_service(
  p_name text,
  p_description text,
  p_duration int,
  p_price int,
  p_barber_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_name text := trim(coalesce(p_name, ''));
  v_description text := trim(coalesce(p_description, ''));
  v_barbers uuid[];
begin
  perform public.assert_owner('services');
  if length(v_name) < 2 or length(v_name) > 60 then
    raise exception 'Indique le nom de la prestation (2 à 60 caractères).';
  end if;
  if length(v_description) > 240 then
    raise exception 'La description est trop longue (240 caractères au plus).';
  end if;
  if exists (select 1 from public.services where lower(name) = lower(v_name) and active) then
    raise exception 'Une prestation porte déjà ce nom.';
  end if;
  if p_duration is null or p_duration < 10 or p_duration > 240 or p_duration % 5 <> 0 then
    raise exception 'Durée invalide (10 à 240 minutes, par pas de 5).';
  end if;
  if p_price is null or p_price <= 0 or p_price > 100000 then
    raise exception 'Tarif invalide.';
  end if;
  select array_agg(distinct b.id) into v_barbers
  from public.barbers b
  where b.id = any(coalesce(p_barber_ids, '{}'::uuid[])) and b.active;
  if v_barbers is null or cardinality(v_barbers) <> (select count(distinct x) from unnest(p_barber_ids) x) then
    raise exception 'Choisis au moins un coiffeur actif pour cette prestation.';
  end if;
  insert into public.services (id, slug, name, description, duration_minutes, price_cents, photo_path, sort_order, active)
  values (
    v_id,
    public.catalogue_slug('services', v_name),
    v_name,
    v_description,
    p_duration,
    p_price,
    '',
    coalesce((select max(sort_order) from public.services), 0) + 1,
    true
  );
  insert into public.barber_services (barber_id, service_id)
  select b, v_id from unnest(v_barbers) b;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'prestation_ajout', 'service', v_id::text,
    jsonb_build_object('nom', v_name, 'duree', p_duration, 'prix_ht', p_price));
  return v_id;
end;
$$;

create or replace function public.admin_archive_service(p_service uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_active boolean;
  v_upcoming int;
  v_orphans text;
begin
  perform public.assert_owner('services');
  -- Verrouille les chaises qui offrent la prestation : create_booking prend le même
  -- verrou avant de relire services.active, donc pas de réservation glissée entre deux.
  perform 1 from public.barbers b
  where exists (select 1 from public.barber_services bs where bs.barber_id = b.id and bs.service_id = p_service)
  order by b.id
  for update;
  select name, active into v_name, v_active from public.services where id = p_service for update;
  if not found then
    raise exception 'Prestation introuvable.';
  end if;
  if not v_active then
    raise exception 'Cette prestation est déjà retirée.';
  end if;
  if (select count(*) from public.services where active and id <> p_service) < 1 then
    raise exception 'Le catalogue doit garder au moins une prestation.';
  end if;
  select count(*) into v_upcoming from public.bookings
  where service_id = p_service and status in ('en_attente_paiement', 'confirme') and ends_at > now();
  if v_upcoming > 0 then
    raise exception '« % » a encore % rendez-vous à venir. Déplace-les ou annule-les dans l’agenda, puis réessaie.',
      v_name, v_upcoming;
  end if;
  select string_agg(b.short_name, ', ' order by b.sort_order) into v_orphans
  from public.barbers b
  where b.active
    and exists (select 1 from public.barber_services bs where bs.barber_id = b.id and bs.service_id = p_service)
    and not exists (
      select 1 from public.barber_services bs
      join public.services s on s.id = bs.service_id
      where bs.barber_id = b.id and s.active and s.id <> p_service
    );
  if v_orphans is not null then
    raise exception 'C’est la seule prestation de : %. Ajoute-leur une autre prestation avant de retirer celle-ci.', v_orphans;
  end if;
  update public.services set active = false where id = p_service;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'prestation_retrait', 'service', p_service::text, jsonb_build_object('nom', v_name));
end;
$$;

create or replace function public.admin_reactivate_service(p_service uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  perform public.assert_owner('services');
  update public.services set active = true where id = p_service and not active returning name into v_name;
  if v_name is null then
    raise exception 'Cette prestation est déjà active.';
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'prestation_reactivation', 'service', p_service::text, jsonb_build_object('nom', v_name));
end;
$$;

-- Un coiffeur actif garde toujours au moins une prestation active.
create or replace function public.admin_set_service(p_barber uuid, p_service uuid, p_eligible boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_staff('barbers');
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

-- Un compte coiffeur ne se réactive pas sur une chaise retirée.
create or replace function public.admin_set_active(p_user uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_staff('team');
  if not p_active
     and exists (select 1 from public.profiles where id = p_user and role = 'proprietaire' and active)
     and (select count(*) from public.profiles where role = 'proprietaire' and active and id <> p_user) < 1 then
    raise exception 'Il doit rester au moins un propriétaire actif.';
  end if;
  if p_active and exists (
    select 1 from public.profiles p
    join public.barbers b on b.id = p.barber_id
    where p.id = p_user and p.role = 'coiffeur' and not b.active
  ) then
    raise exception 'La chaise de ce coiffeur est retirée. Réactive-la dans Coiffeurs d’abord.';
  end if;
  update public.profiles
  set active = p_active, invited_at = null
  where id = p_user;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), case when p_active then 'reactivation' else 'desactivation' end, 'profile', p_user::text, '{}'::jsonb);
end;
$$;

-- Un rendez-vous passé non honoré d’une chaise ou d’une prestation retirée
-- ne peut pas être ramené dans le futur.
create or replace function public.admin_move(p_booking uuid, p_date date, p_start integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  v_open int;
  v_close int;
  v_dow int;
  v_occupancy int;
  v_starts timestamptz;
begin
  perform public.assert_staff('move');
  select * into b from public.bookings where id = p_booking and status = 'confirme';
  if not found then
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

-- list_slots : seules les chaises actives qui travaillent ce jour-là proposent des
-- créneaux (create_booking refusait déjà les autres jours).
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

revoke execute on function public.catalogue_slug(text, text) from public, anon, authenticated;
revoke execute on function public.assert_owner(text) from public, anon, authenticated;
revoke execute on function public.admin_barbers() from public, anon;
revoke execute on function public.admin_create_barber(text, text, text, int[], uuid[]) from public, anon;
revoke execute on function public.admin_archive_barber(uuid) from public, anon;
revoke execute on function public.admin_reactivate_barber(uuid) from public, anon;
revoke execute on function public.admin_services() from public, anon;
revoke execute on function public.admin_create_service(text, text, int, int, uuid[]) from public, anon;
revoke execute on function public.admin_archive_service(uuid) from public, anon;
revoke execute on function public.admin_reactivate_service(uuid) from public, anon;

grant execute on function public.admin_barbers() to authenticated;
grant execute on function public.admin_create_barber(text, text, text, int[], uuid[]) to authenticated;
grant execute on function public.admin_archive_barber(uuid) to authenticated;
grant execute on function public.admin_reactivate_barber(uuid) to authenticated;
grant execute on function public.admin_services() to authenticated;
grant execute on function public.admin_create_service(text, text, int, int, uuid[]) to authenticated;
grant execute on function public.admin_archive_service(uuid) to authenticated;
grant execute on function public.admin_reactivate_service(uuid) to authenticated;
grant execute on function public.admin_set_service(uuid, uuid, boolean) to authenticated;
grant execute on function public.admin_set_active(uuid, boolean) to authenticated;
grant execute on function public.admin_move(uuid, date, int) to authenticated;
grant execute on function public.list_slots(uuid, date, uuid) to anon, authenticated;
