-- Agent-shared client progress links remember who they were emailed to.
-- Run once in the Supabase SQL Editor (safe to re-run).
alter table public.external_access_links add column if not exists client_email text;

notify pgrst, 'reload schema';

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'external_access_links' and column_name = 'client_email';
