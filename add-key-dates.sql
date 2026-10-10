-- Critical dates: the contract's own deadlines (earnest money due, inspection,
-- appraisal, financing contingency, title commitment, closing) plus any custom
-- ones, shown on each transaction and in a cross-transaction "Critical dates"
-- view, and included in the daily reminder email.
--
-- Written and read only by the server (service-role key), which checks the
-- caller's access to the transaction on every request. anon/authenticated get
-- no access, same as every other table (see lock-down-database-access.sql).
-- Run once in the Supabase SQL Editor.

create table if not exists public.transaction_key_dates (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  -- earnest_money | inspection | appraisal | financing | title_commitment | closing | custom
  kind           text not null default 'custom',
  label          text not null check (char_length(label) between 1 and 100),
  due_date       date not null,
  completed      boolean not null default false,
  -- 'contract' = pulled from an uploaded contract, 'manual' = typed in
  source         text not null default 'manual',
  -- also email this deadline to the deal's agent (off by default)
  notify_agent   boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_key_dates_transaction on public.transaction_key_dates (transaction_id, due_date);
create index if not exists idx_key_dates_due_open on public.transaction_key_dates (due_date) where completed = false;

alter table public.transaction_key_dates enable row level security;
revoke all on table public.transaction_key_dates from anon, authenticated;
grant select, insert, update, delete on table public.transaction_key_dates to service_role;

-- Verify (should list only service_role):
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'transaction_key_dates'
order by grantee, privilege_type;
