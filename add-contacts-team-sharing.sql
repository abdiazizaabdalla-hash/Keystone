-- Team-shared contacts. Every contact stays personal unless its owner shares it with their
-- team; a shared contact is visible to, and editable by, every member of that team. The
-- contact always stays on the owner's account (tc_user_id): stopping sharing, or the team
-- ending, returns it to the owner's personal list. Run after add-contacts-relationships.sql.
-- Safe to re-run. Run in the Supabase SQL editor.

alter table public.contacts add column if not exists team_id uuid references public.teams(id) on delete set null;
alter table public.contacts add column if not exists shared_at timestamptz;

create index if not exists idx_contacts_team on public.contacts (team_id) where team_id is not null;
-- one shared contact per email in a team's shared list
create unique index if not exists contacts_team_email_uniq on public.contacts (team_id, lower(email)) where team_id is not null and email is not null;
