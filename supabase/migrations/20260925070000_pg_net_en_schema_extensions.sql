-- pg_net fuera del schema public (recomendación del linter de seguridad de Supabase).
drop extension if exists pg_net;
create extension if not exists pg_net with schema extensions;
