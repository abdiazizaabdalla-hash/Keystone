-- Custom folders for commonly used documents, plus pinning of official state sources and custom folders.
-- Safe to run more than once.
create table if not exists public.template_folders (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  name          text not null check (char_length(name) between 1 and 60),
  created_at    timestamptz not null default now()
);
create unique index if not exists uq_template_folders_owner_name on public.template_folders (owner_user_id, lower(name));

create table if not exists public.template_folder_items (
  id            uuid primary key default gen_random_uuid(),
  folder_id     uuid not null references public.template_folders (id) on delete cascade,
  owner_user_id uuid not null,
  kind          text not null check (kind in ('template', 'trec', 'source')),
  ref           text not null,
  created_at    timestamptz not null default now(),
  unique (folder_id, kind, ref)
);
create index if not exists idx_template_folder_items_folder on public.template_folder_items (folder_id);

alter table public.template_pins drop constraint if exists template_pins_kind_check;
alter table public.template_pins add constraint template_pins_kind_check check (kind in ('folder', 'template', 'trec', 'source', 'custom'));

alter table public.template_folders enable row level security;
alter table public.template_folder_items enable row level security;
revoke all on table public.template_folders from anon, authenticated;
revoke all on table public.template_folder_items from anon, authenticated;
grant select, insert, update, delete on table public.template_folders to service_role;
grant select, insert, update, delete on table public.template_folder_items to service_role;
