-- C3 : admin_move valide le jour, les heures, le passé, l’admissibilité et les blocages
-- avant d’écrire. L’agenda expose la prestation pour le sélecteur de créneaux.

create or replace function public.admin_move(p_booking uuid, p_date date, p_start int)
returns void
language plpgsql
security definer
set search_path = public
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
        b.service_id as "serviceId", b.duration_minutes as "durationMinutes",
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
        null::uuid, null::int,
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
