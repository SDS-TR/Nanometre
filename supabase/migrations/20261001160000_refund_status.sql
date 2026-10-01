-- Valeur d'énumération isolée : PostgreSQL n'autorise son usage qu'après le commit.
alter type public.payment_status add value if not exists 'remboursement_en_cours';
