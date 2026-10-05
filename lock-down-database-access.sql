-- Lock the database away from the public API.
--
-- Why: Relay's server code talks to Postgres with the service-role key, which
-- bypasses Row Level Security, and the browser only uses Supabase for sign-in
-- (never for reading or writing data). But Supabase also exposes every table in
-- the `public` schema over its REST API to anyone holding the public anon key,
-- which ships in the site's JavaScript. A check on the live project showed the
-- `transactions`, `invoices` and `tasks` tables answering unauthenticated reads
-- (addresses, prices, fees), so some table was open to the anon role.
--
-- This script removes the anon and authenticated roles' access to every table
-- in `public` and turns RLS on everywhere. The app is unaffected because the
-- service-role key keeps working.
--
-- Run in the Supabase dashboard -> SQL Editor. Run STEP 1 first and look at the
-- output; then run STEP 2. Safe to re-run.

-- ---- STEP 1: look (read-only) ---------------------------------------------
select tablename, rowsecurity as rls_enabled from pg_tables where schemaname = 'public' order by tablename;

select tablename, policyname, roles, cmd, qual
from pg_policies where schemaname = 'public' order by tablename, policyname;

select table_name, grantee, string_agg(privilege_type, ', ') as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee order by table_name, grantee;

-- ---- STEP 2: lock down ------------------------------------------------------
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('revoke all on table public.%I from anon, authenticated', r.tablename);
  end loop;
end $$;

-- Tables created later should not be open by default either.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ---- STEP 3: verify (should now show no anon/authenticated grants) ---------
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');
