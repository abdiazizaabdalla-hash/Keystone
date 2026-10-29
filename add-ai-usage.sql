-- AI usage log: one row per AI document read (contract, listing agreement,
-- offer package), so the Admin Users page can show how often each account
-- uses it and roughly how many tokens that cost.
--
-- Written only by the server (service-role key); anon and authenticated get
-- no access, same as every other table (see lock-down-database-access.sql).
-- No document contents are stored, only counts. Run once in the Supabase SQL Editor.

create table if not exists public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid not null,
  feature       text not null,           -- 'contract' | 'listing_agreement' | 'offer'
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0
);

create index if not exists idx_ai_usage_user on public.ai_usage (user_id, created_at desc);
create index if not exists idx_ai_usage_created_at on public.ai_usage (created_at desc);

alter table public.ai_usage enable row level security;
revoke all on table public.ai_usage from anon, authenticated;
grant select, insert on table public.ai_usage to service_role;

notify pgrst, 'reload schema';

-- Verify (should list no anon/authenticated grants):
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'ai_usage' order by grantee, privilege_type;
