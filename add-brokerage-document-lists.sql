-- Brokerage Pro: more than one required-document list. The list on brokerage_file_requirements stays the default for every file;
-- each list here applies to files whose checklist template is named in template_names (for example "Cash" or "Condo").
-- Safe to run more than once. Run after add-brokerage-file-review.sql. Nothing changes until an owner adds a list.
create table if not exists public.brokerage_document_lists (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  name           text not null check (char_length(name) between 1 and 60),
  template_names text[] not null default '{}',
  document_types text[] not null default '{}',
  position       int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_brokerage_document_lists_owner on public.brokerage_document_lists (owner_user_id, position);

alter table public.brokerage_document_lists enable row level security;
revoke all on table public.brokerage_document_lists from anon, authenticated;
grant select, insert, update, delete on table public.brokerage_document_lists to service_role;

notify pgrst, 'reload schema';
