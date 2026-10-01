-- Comptes de démonstration. Uniquement `supabase db reset` en local.
-- Ne jamais appliquer ce fichier sur un projet hébergé.

do $$ begin

  if not exists (select 1 from auth.users where id = '11111111-1111-4111-8111-111111111111') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
      'alex.gagnon@exemple.ca', crypt('nanometre', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name": "Alex Gagnon", "role": "client"}'::jsonb, now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), '11111111-1111-4111-8111-111111111111',
      jsonb_build_object('sub', '11111111-1111-4111-8111-111111111111', 'email', 'alex.gagnon@exemple.ca'),
      'email', '11111111-1111-4111-8111-111111111111', now(), now(), now()
    );
  end if;

  if not exists (select 1 from auth.users where id = '22222222-2222-4222-8222-222222222222') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
      'karim@lenanometre.ca', crypt('nanometre', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name": "Karim B.", "role": "proprietaire"}'::jsonb, now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), '22222222-2222-4222-8222-222222222222',
      jsonb_build_object('sub', '22222222-2222-4222-8222-222222222222', 'email', 'karim@lenanometre.ca'),
      'email', '22222222-2222-4222-8222-222222222222', now(), now(), now()
    );
  end if;

  if not exists (select 1 from auth.users where id = '33333333-3333-4333-8333-333333333333') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated',
      'julien.morel@lenanometre.ca', crypt('nanometre', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name": "Julien Morel", "role": "coiffeur"}'::jsonb, now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), '33333333-3333-4333-8333-333333333333',
      jsonb_build_object('sub', '33333333-3333-4333-8333-333333333333', 'email', 'julien.morel@lenanometre.ca'),
      'email', '33333333-3333-4333-8333-333333333333', now(), now(), now()
    );
  end if;
exception when undefined_table then
  raise notice 'auth.users absent — utilise scripts/seed-hosted.mjs';
end $$;
