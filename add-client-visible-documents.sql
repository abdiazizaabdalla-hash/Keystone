-- Agents choose which deal documents their client can open from the
-- client progress page. Off by default: nothing is visible until the agent ticks it.
-- Run once in the Supabase SQL Editor (safe to re-run).
alter table public.documents add column if not exists client_visible boolean not null default false;

notify pgrst, 'reload schema';

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'documents' and column_name = 'client_visible';
