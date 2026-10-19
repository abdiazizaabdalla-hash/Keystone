-- Calendar sync + subscribable calendar link.
-- Safe to run more than once (everything is IF NOT EXISTS).
--
-- 1) calendar_connections: one row per Relay user who connected Google
--    Calendar. `tc_user_id` is a historical column name -- it holds ANY Relay
--    user id (a TC or an agent). `refresh_token` is encrypted with
--    encryptSecret() (src/lib/encryption.ts) and never stored in plain text.
-- 2) tasks.google_event_id: which Google event a checklist task's due date is
--    synced to (TC side).
-- 3) key_date_calendar_events: which Google event each critical date was
--    written to, per person (TC and each agent), so edits update the same event.
-- 4) calendar_feed_tokens: the secret in a user's "subscribe to my calendar"
--    link (works with any calendar app, no Google permission needed).

create table if not exists public.calendar_connections (
  id            uuid primary key default gen_random_uuid(),
  tc_user_id    uuid not null,
  provider      text not null default 'google',
  refresh_token text not null,
  google_email  text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (tc_user_id, provider)
);
create index if not exists idx_calendar_connections_tc_user_id on public.calendar_connections (tc_user_id);

alter table public.tasks add column if not exists google_event_id text;

create table if not exists public.key_date_calendar_events (
  id              uuid primary key default gen_random_uuid(),
  key_date_id     uuid not null references public.transaction_key_dates(id) on delete cascade,
  user_id         uuid not null,
  google_event_id text not null,
  created_at      timestamptz not null default now(),
  unique (key_date_id, user_id)
);
create index if not exists idx_kdce_user on public.key_date_calendar_events (user_id);

create table if not exists public.calendar_feed_tokens (
  user_id    uuid primary key,
  token      text not null unique,
  created_at timestamptz not null default now()
);

-- Same lock-down as every other table: only the server (service role) touches these.
alter table public.calendar_connections       enable row level security;
alter table public.key_date_calendar_events   enable row level security;
alter table public.calendar_feed_tokens       enable row level security;

revoke all on table public.calendar_connections       from anon, authenticated;
revoke all on table public.key_date_calendar_events   from anon, authenticated;
revoke all on table public.calendar_feed_tokens       from anon, authenticated;

grant select, insert, update, delete on table public.calendar_connections       to service_role;
grant select, insert, update, delete on table public.key_date_calendar_events   to service_role;
grant select, insert, update, delete on table public.calendar_feed_tokens       to service_role;

select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('calendar_connections', 'key_date_calendar_events', 'calendar_feed_tokens')
order by table_name, grantee, privilege_type;
