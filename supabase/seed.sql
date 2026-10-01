-- Ne pas exécuter ce fichier.
-- Projet hébergé : seed.catalogue.sql seulement, et jamais seed.demo.sql.
-- Local : supabase db reset applique le catalogue puis la démo.
do $$ begin
  raise exception 'seed.sql est retiré. Catalogue : seed.catalogue.sql. Démo locale : seed.demo.sql.';
end $$;

