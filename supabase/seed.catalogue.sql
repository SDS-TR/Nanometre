-- Catalogue du salon. Aucun profil, aucun rendez-vous, aucun mot de passe.
-- C'est le seul seed applicable à un projet hébergé, et encore : de préférence à la main.

-- Généré par scripts/generate_seed.py — ne pas éditer à la main.
insert into public.salon_settings (id, name, tagline, address, city, timezone, open_minute, close_minute, gst_number, qst_number, phone)
values (1, 'Le Nanomètre', 'Barbier pour hommes', '425, rue Saint-Vallier Ouest', 'Québec (Québec) G1K 1K8', 'America/Toronto', 540, 1140, '123456789 RT0001', '1234567890 TQ0001', '418 555-0199')
on conflict (id) do update set name = excluded.name;

insert into public.barbers (id, slug, full_name, short_name, specialty, bio, years, photo_path, rating, review_count, sort_order) values
('20000000-0000-4000-8000-000000000001'::uuid, 'karim-b', 'Karim B.', 'Karim', 'Dégradés précis', 'Karim tient la chaise du fond depuis l''ouverture. Il prend son temps sur les fondus et laisse la nuque impeccable.', 8, 'karim-b', 4.89, 18, 1),
('20000000-0000-4000-8000-000000000002'::uuid, 'julien-morel', 'Julien Morel', 'Julien', 'Coupe et barbe', 'Julien aime les rendez-vous complets : une coupe qui tient la semaine et une barbe dessinée au rasoir.', 6, 'julien-morel', 4.67, 9, 2),
('20000000-0000-4000-8000-000000000003'::uuid, 'samuel-tremblay', 'Samuel Tremblay', 'Samuel', 'Classiques nettes', 'Samuel vient de Limoilou. Il coupe court, propre, et discute autant que le client en a envie.', 5, 'samuel-tremblay', 4.88, 8, 3),
('20000000-0000-4000-8000-000000000004'::uuid, 'ousmane-diallo', 'Ousmane Diallo', 'Ousmane', 'Textures et contours', 'Ousmane travaille les cheveux texturés et les lignes franches. Il explique chaque étape avant de sortir la tondeuse.', 7, 'ousmane-diallo', 4.57, 7, 4),
('20000000-0000-4000-8000-000000000005'::uuid, 'marco-rossi', 'Marco Rossi', 'Marco', 'Rasage à l''ancienne', 'Marco ferme souvent la journée avec un rasage serviette chaude. Le geste est lent, le résultat est lisse.', 11, 'marco-rossi', 3.67, 3, 5) on conflict (id) do nothing;

insert into public.services (id, slug, name, description, duration_minutes, price_cents, photo_path, sort_order) values
('30000000-0000-4000-8000-000000000001'::uuid, 'coupe-classique', 'Coupe classique', 'Ciseaux et tondeuse, contours nets, coiffage simple.', 30, 3500, 'coupe-classique', 1),
('30000000-0000-4000-8000-000000000002'::uuid, 'degrade-blanc', 'Dégradé à blanc', 'Fondu progressif jusqu''au ras, ligne précise à la tempe.', 45, 4000, 'degrade-blanc', 2),
('30000000-0000-4000-8000-000000000003'::uuid, 'coupe-barbe', 'Coupe + barbe', 'La coupe et la taille de barbe dans le même rendez-vous.', 60, 5500, 'coupe-barbe', 3),
('30000000-0000-4000-8000-000000000004'::uuid, 'taille-barbe', 'Taille de barbe', 'Lignes, joues et cou, finition à l''huile.', 20, 2500, 'taille-barbe', 4),
('30000000-0000-4000-8000-000000000005'::uuid, 'rasage-ancienne', 'Rasage à l''ancienne', 'Serviette chaude, rasoir de barbier et baume.', 40, 4500, 'rasage-ancienne', 5),
('30000000-0000-4000-8000-000000000006'::uuid, 'coupe-enfant', 'Coupe enfant', 'Pour les moins de 12 ans, avec un parent à côté du fauteuil.', 30, 2500, 'coupe-enfant', 6) on conflict (id) do nothing;

insert into public.barber_services (barber_id, service_id)
select b.id, s.id from public.barbers b cross join public.services s
on conflict do nothing;

insert into public.schedules (barber_id, weekday, start_minute, end_minute)
select b.id, d.weekday, 540, 1140 from public.barbers b
cross join (values (2), (3), (4), (5), (6)) as d(weekday)
on conflict do nothing;

insert into public.promo_codes (code, discount_type, value, starts_on, ends_on, usage_limit, usage_count) values
('ETE20', 'percent', 20, '2026-07-01', '2026-08-31', 30, 30),
('BIENVENUE10', 'percent', 10, '2026-07-01', '2026-12-31', 100, 95),
('RENTREE5', 'amount', 5, '2026-09-01', '2026-09-30', 50, 46),
('MARDI15', 'percent', 15, '2026-10-06', '2026-11-24', 40, 0) on conflict (code) do nothing;

