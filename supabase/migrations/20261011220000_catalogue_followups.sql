-- Suivis de la contre-vérification de 2051166 (N-1 et N-4).
-- N-1 admin_set_service refuse de retirer une prestation qu’un coiffeur doit encore
--     faire pour des rendez-vous à venir, et journalise chaque changement.
-- N-4 admin_reactivate_service exige au moins un coiffeur actif qui fait la
--     prestation. Le propriétaire peut les choisir dans le même appel.
-- Toutes les fonctions : SECURITY DEFINER, search_path vide, noms qualifiés,
-- verrou de chaise en premier (chaise, puis prestation, puis rendez-vous).

-- N-1 : verrou de chaise (F-4), rendez-vous à venir protégés, journal.
create or replace function public.admin_set_service(p_barber uuid, p_service uuid, p_eligible boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_short text;
  v_active boolean;
  v_service text;
  v_upcoming int;
  v_rows int;
begin
  perform public.assert_staff('barbers');
  if p_eligible is null then
    raise exception 'Réglage invalide.';
  end if;
  -- Même verrou que create_booking et admin_move : aucune réservation ni aucun
  -- déplacement ne se glisse sur cette chaise pendant le contrôle.
  select short_name, active into v_short, v_active from public.barbers where id = p_barber for update;
  if not found then
    raise exception 'Coiffeur introuvable.';
  end if;
  select name into v_service from public.services where id = p_service;
  if not found then
    raise exception 'Prestation introuvable.';
  end if;
  if p_eligible then
    if not exists (select 1 from public.services where id = p_service and active) then
      raise exception 'Cette prestation est retirée.';
    end if;
    insert into public.barber_services (barber_id, service_id) values (p_barber, p_service)
    on conflict do nothing;
    get diagnostics v_rows = row_count;
  else
    if not exists (select 1 from public.barber_services where barber_id = p_barber and service_id = p_service) then
      return;
    end if;
    if v_active and not exists (
      select 1 from public.barber_services bs
      join public.services s on s.id = bs.service_id
      where bs.barber_id = p_barber and s.active and s.id <> p_service
    ) then
      raise exception 'Un coiffeur actif doit garder au moins une prestation.';
    end if;
    select count(*) into v_upcoming from public.bookings
    where barber_id = p_barber
      and service_id = p_service
      and status in ('en_attente_paiement', 'confirme')
      and ends_at > now();
    if v_upcoming > 0 then
      raise exception '% a encore % rendez-vous à venir pour « % ». Déplace-les ou annule-les dans l’agenda, puis réessaie.',
        v_short, v_upcoming, v_service;
    end if;
    delete from public.barber_services where barber_id = p_barber and service_id = p_service;
    get diagnostics v_rows = row_count;
  end if;
  if v_rows > 0 then
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (auth.uid(), 'coiffeur_prestation', 'barber', p_barber::text,
      jsonb_build_object('prestation', v_service, 'service_id', p_service, 'offerte', p_eligible));
  end if;
end;
$$;

-- N-4 : une prestation réactivée est faite par au moins un coiffeur actif.
-- p_barbers ajoute des coiffeurs actifs à la prestation dans la même transaction.
drop function if exists public.admin_reactivate_service(uuid);

create or replace function public.admin_reactivate_service(p_service uuid, p_barbers uuid[] default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_active boolean;
  v_barbers uuid[] := coalesce(p_barbers, '{}');
  v_added int := 0;
begin
  perform public.assert_owner('services');
  if cardinality(v_barbers) > 50 or array_position(v_barbers, null) is not null then
    raise exception 'Choisis au moins un coiffeur actif pour cette prestation.';
  end if;
  -- Chaises d’abord, triées par id, comme admin_archive_service : create_booking
  -- relit services.active sous ce même verrou.
  perform 1 from public.barbers b
  where b.id = any (v_barbers)
     or exists (select 1 from public.barber_services bs where bs.barber_id = b.id and bs.service_id = p_service)
  order by b.id
  for update;
  select name, active into v_name, v_active from public.services where id = p_service for update;
  if not found then
    raise exception 'Prestation introuvable.';
  end if;
  if v_active then
    raise exception 'Cette prestation est déjà active.';
  end if;
  if exists (
    select 1 from unnest(v_barbers) as chosen(id)
    where not exists (select 1 from public.barbers b where b.id = chosen.id and b.active)
  ) then
    raise exception 'Choisis au moins un coiffeur actif pour cette prestation.';
  end if;
  insert into public.barber_services (barber_id, service_id)
  select distinct chosen.id, p_service from unnest(v_barbers) as chosen(id)
  on conflict do nothing;
  get diagnostics v_added = row_count;
  if not exists (
    select 1 from public.barber_services bs
    join public.barbers b on b.id = bs.barber_id
    where bs.service_id = p_service and b.active
  ) then
    raise exception '« % » n’est faite par aucun coiffeur actif. Choisis au moins un coiffeur, puis réactive-la.', v_name;
  end if;
  update public.services set active = true where id = p_service;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'prestation_reactivation', 'service', p_service::text,
    jsonb_build_object('nom', v_name, 'coiffeurs_ajoutes', v_added));
end;
$$;

revoke execute on function public.admin_set_service(uuid, uuid, boolean) from public, anon;
revoke execute on function public.admin_reactivate_service(uuid, uuid[]) from public, anon;

grant execute on function public.admin_set_service(uuid, uuid, boolean) to authenticated;
grant execute on function public.admin_reactivate_service(uuid, uuid[]) to authenticated;
