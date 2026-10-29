-- Lets an agent say "share new documents I upload with my client automatically".
-- Run once in the Supabase SQL Editor (safe to re-run).
alter table public.transactions add column if not exists client_share_new_documents boolean not null default false;

notify pgrst, 'reload schema';

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'transactions' and column_name = 'client_share_new_documents';
