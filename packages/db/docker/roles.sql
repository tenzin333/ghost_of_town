-- Roles that exist on every Supabase project. Local only: migrations assume them and never create them.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password 'postgres';
grant anon, authenticated, service_role to authenticator;
create schema if not exists extensions;
alter database postgres set search_path = "$user", public, extensions;
