-- Brokerage file review: the owner chooses which documents every closed file must contain, then marks each file reviewed or
-- flags it for follow-up. Read-only for agents (they are told when a file is flagged). Safe to run more than once.
-- Nothing here is used unless the `brokerage` feature is switched on.
create table if not exists public.brokerage_file_requirements (
  owner_user_id  uuid primary key,
  document_types text[] not null default '{}',
  updated_at     timestamptz not null default now()
);

create table if not exists public.brokerage_file_reviews (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  status         text not null check (status in ('reviewed', 'flagged')),
  note           text check (note is null or char_length(note) <= 500),
  reviewed_at    timestamptz not null default now(),
  unique (owner_user_id, transaction_id)
);
create index if not exists idx_brokerage_file_reviews_owner on public.brokerage_file_reviews (owner_user_id, status);

alter table public.brokerage_file_requirements enable row level security;
alter table public.brokerage_file_reviews enable row level security;
revoke all on table public.brokerage_file_requirements from anon, authenticated;
revoke all on table public.brokerage_file_reviews from anon, authenticated;
grant select, insert, update, delete on table public.brokerage_file_requirements to service_role;
grant select, insert, update, delete on table public.brokerage_file_reviews to service_role;

select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('brokerage_file_requirements', 'brokerage_file_reviews') order by table_name, grantee, privilege_type;
