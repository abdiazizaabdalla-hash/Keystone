-- Contacts CRM, layers 1 and 2: organizations, an agent link, a notes/activity
-- timeline, and follow-up reminders. Run after add-contacts-crm.sql.
-- Safe to re-run. Run in the Supabase SQL editor.

-- 1. Contacts: person vs organization, who works where, and the link to an agent profile.
alter table public.contacts add column if not exists contact_type text not null default 'person';
alter table public.contacts add column if not exists organization_id uuid references public.contacts(id) on delete set null;
alter table public.contacts add column if not exists agent_id uuid references public.agents(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_type_check') then
    alter table public.contacts add constraint contacts_type_check check (contact_type in ('person', 'organization'));
  end if;
  -- an organization cannot "work at" itself
  if not exists (select 1 from pg_constraint where conname = 'contacts_org_not_self') then
    alter table public.contacts add constraint contacts_org_not_self check (organization_id is null or organization_id <> id);
  end if;
end $$;

create index if not exists idx_contacts_org on public.contacts (organization_id) where organization_id is not null;
-- one contact per agent profile, per TC
create unique index if not exists contacts_agent_uniq on public.contacts (tc_user_id, agent_id) where agent_id is not null;

-- 2. Timeline: notes and recorded interactions (call, email, text, meeting).
create table if not exists public.contact_activity (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  tc_user_id   uuid not null,
  -- note | call | email | text | meeting | other
  kind         text not null default 'note' check (kind in ('note', 'call', 'email', 'text', 'meeting', 'other')),
  body         text not null check (char_length(body) between 1 and 4000),
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_contact_activity_contact on public.contact_activity (contact_id, occurred_at desc);
create index if not exists idx_contact_activity_user on public.contact_activity (tc_user_id);

-- 3. Follow-up reminders.
create table if not exists public.contact_reminders (
  id           uuid primary key default gen_random_uuid(),
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  tc_user_id   uuid not null,
  due_on       date not null,
  note         text check (note is null or char_length(note) <= 300),
  done_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_contact_reminders_contact on public.contact_reminders (contact_id);
create index if not exists idx_contact_reminders_open on public.contact_reminders (tc_user_id, due_on) where done_at is null;

-- Same lock-down as the contacts table: only the server (service role) can touch these.
alter table public.contact_activity enable row level security;
alter table public.contact_reminders enable row level security;
revoke all on table public.contact_activity from anon, authenticated;
revoke all on table public.contact_reminders from anon, authenticated;
grant select, insert, update, delete on table public.contact_activity to service_role;
grant select, insert, update, delete on table public.contact_reminders to service_role;
