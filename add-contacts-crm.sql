-- Contacts: a TC's own address book of everyone in their business (agents,
-- lenders, title/escrow, inspectors, past clients), with tags and a newsletter
-- flag that exports to any email tool. Safe to re-run.
create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  tc_user_id  uuid not null,
  name        text not null default '' check (char_length(name) <= 120),
  email       text check (email is null or char_length(email) <= 254),
  phone       text check (phone is null or char_length(phone) <= 40),
  company     text check (company is null or char_length(company) <= 120),
  role        text check (role is null or char_length(role) <= 60),
  notes       text check (notes is null or char_length(notes) <= 2000),
  tags        text[] not null default '{}',
  -- true only when the TC says this person agreed to receive their newsletter
  newsletter  boolean not null default false,
  -- manual | deals | import
  source      text not null default 'manual',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (name <> '' or email is not null)
);

create unique index if not exists contacts_user_email_uniq on public.contacts (tc_user_id, lower(email)) where email is not null;
create index if not exists idx_contacts_user on public.contacts (tc_user_id);
create index if not exists idx_contacts_tags on public.contacts using gin (tags);

alter table public.contacts enable row level security;
revoke all on table public.contacts from anon, authenticated;
grant select, insert, update, delete on table public.contacts to service_role;

select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'contacts'
order by grantee, privilege_type;
