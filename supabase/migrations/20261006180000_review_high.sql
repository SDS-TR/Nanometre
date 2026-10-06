-- E2, E3, E4 : prix strictement positif, promo bornée sans remettre le compteur à zéro,
-- prestations publiées avec chaque coiffeur.

alter table public.promo_codes add column if not exists active boolean not null default true;

create or replace function public.admin_update_service(p_id uuid, p_price int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_staff('services');
  if p_price is null or p_price <= 0 then
    raise exception 'Tarif invalide.';
  end if;
  update public.services set price_cents = p_price where id = p_id;
end;
$$;

create or replace function public.admin_save_promo(p_promo jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(p_promo->>'code'));
  v_type text := case when p_promo->>'discountType' = 'percent' then 'percent' else 'amount' end;
  v_value numeric := (p_promo->>'value')::numeric;
  v_start date := (p_promo->>'startsOn')::date;
  v_end date := (p_promo->>'endsOn')::date;
  v_limit int := nullif(p_promo->>'usageLimit', '')::int;
  v_active boolean := coalesce((p_promo->>'active')::boolean, true);
begin
  perform public.assert_staff('promos');
  if v_code !~ '^[A-Z0-9]{3,24}$' then
    raise exception 'Code invalide.';
  end if;
  if v_type = 'percent' and (v_value < 1 or v_value > 100 or v_value <> trunc(v_value)) then
    raise exception 'Le pourcentage doit être entre 1 et 100.';
  end if;
  if v_type = 'amount' then
    v_value := v_value / 100;
    if v_value <= 0 then
      raise exception 'Le montant doit être supérieur à 0.';
    end if;
  end if;
  if v_start is null or v_end is null or v_end < v_start then
    raise exception 'Dates invalides.';
  end if;
  if v_limit is not null and v_limit < 1 then
    raise exception 'Limite invalide.';
  end if;
  insert into public.promo_codes (code, discount_type, value, starts_on, ends_on, usage_limit, usage_count, active)
  values (v_code, v_type, v_value, v_start, v_end, v_limit, 0, v_active)
  on conflict (code) do update set
    discount_type = excluded.discount_type,
    value = excluded.value,
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    usage_limit = excluded.usage_limit,
    active = excluded.active,
    usage_count = public.promo_codes.usage_count;
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
      'startsOn', starts_on,
      'endsOn', ends_on,
      'usageLimit', usage_limit,
      'usageCount', usage_count,
      'active', active
    )), '[]'::jsonb)
    from public.promo_codes
  );
end;
$$;

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
  if not found or promo.active is not true then
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
    'sortOrder', sort_order,
    'serviceIds', coalesce((select jsonb_agg(bs.service_id) from public.barber_services bs where bs.barber_id = barbers.id), '[]'::jsonb)
  ) order by sort_order), '[]'::jsonb)
  from public.barbers
  where active
$$;
