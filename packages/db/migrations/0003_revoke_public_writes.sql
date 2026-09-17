-- Supabase grants anon/authenticated ALL on new public tables. RLS already blocks writes (no write policies), but
-- UPDATE/DELETE then silently match 0 rows and TRUNCATE ignores RLS. Make the public roles read-only outright.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.places, public.layers, public.sources, public.layer_sources, public.media
  FROM anon, authenticated;--> statement-breakpoint
-- Same for tables created later by the postgres role (future migrations grant SELECT explicitly).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;
