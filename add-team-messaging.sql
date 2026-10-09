-- Team messaging: a general team board + direct messages between teammates.
-- Shown on the Collaborate page (Team / Brokerage plans).
--
-- Written and read only by the server (service-role key), which checks team
-- membership on every request. anon/authenticated get no access, same as
-- every other table (see lock-down-database-access.sql).
-- Run once in the Supabase SQL Editor.

create table if not exists public.team_messages (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  sender_id    uuid not null references auth.users(id) on delete cascade,
  -- null = posted to the whole team's board; set = a direct message
  recipient_id uuid references auth.users(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now(),
  constraint team_messages_not_self check (recipient_id is null or recipient_id <> sender_id)
);

create index if not exists idx_team_messages_board
  on public.team_messages (team_id, created_at desc) where recipient_id is null;
create index if not exists idx_team_messages_dm
  on public.team_messages (team_id, sender_id, recipient_id, created_at desc) where recipient_id is not null;
create index if not exists idx_team_messages_recipient
  on public.team_messages (recipient_id, created_at desc) where recipient_id is not null;

-- How far each person has read in each conversation ('board' or the other
-- person's user id), so unread counts survive across devices.
create table if not exists public.team_message_reads (
  user_id      uuid not null references auth.users(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  thread       text not null,
  last_read_at timestamptz not null,
  primary key (user_id, team_id, thread)
);

alter table public.team_messages enable row level security;
alter table public.team_message_reads enable row level security;
revoke all on table public.team_messages from anon, authenticated;
revoke all on table public.team_message_reads from anon, authenticated;
grant select, insert, update, delete on table public.team_messages to service_role;
grant select, insert, update, delete on table public.team_message_reads to service_role;

-- Verify (should list only service_role):
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('team_messages', 'team_message_reads')
order by table_name, grantee, privilege_type;
