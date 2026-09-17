-- Supabase keeps extensions in their own schema (on its search_path). Locally the same schema is created by
-- docker/roles.sql; if PostGIS is already installed elsewhere this is a no-op.
CREATE SCHEMA IF NOT EXISTS extensions;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;--> statement-breakpoint
-- The public API functions run as the caller, who needs to resolve PostGIS types. Supabase already grants this.
GRANT USAGE ON SCHEMA extensions TO anon, authenticated;
