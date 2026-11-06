-- Template library: PDF Templates (by state and document category) and State Resources (links).
-- Safe to run more than once. Nothing existing is changed or removed.

-- Where a PDF template files itself in a deal's Documents when it is added (same categories as the deal Documents tab).
alter table public.doc_templates add column if not exists document_category text not null default 'other';
alter table public.doc_templates add column if not exists document_type text not null default 'General';

-- A person's own links to a state's forms pages (shown under State Resources; never attached to a deal).
create table if not exists public.template_state_links (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  state         text not null check (char_length(state) = 2),
  label         text not null check (char_length(label) between 1 and 140),
  url           text not null check (char_length(url) between 8 and 500),
  created_at    timestamptz not null default now()
);
create index if not exists idx_template_state_links_owner on public.template_state_links (owner_user_id, state);

alter table public.template_state_links enable row level security;
revoke all on table public.template_state_links from anon, authenticated;
grant select, insert, update, delete on table public.template_state_links to service_role;

notify pgrst, 'reload schema';
