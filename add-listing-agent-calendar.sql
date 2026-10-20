-- Google Calendar for listing agents.
-- Safe to run more than once.
--
-- 1) calendar_connections.login_email: the sign-in email of an AGENT who connected their
--    calendar, so a listing shared with that agent (matched by email) can find their connection.
--    It stays empty for coordinators.
-- 2) listing_agent_calendar_events: which Google event each listing date was written to, per
--    agent, so edits update the same event and unsharing removes it. Relay only ever touches
--    events it created itself.

alter table public.calendar_connections add column if not exists login_email text;
create index if not exists idx_calendar_connections_login_email on public.calendar_connections (lower(login_email));

create table if not exists public.listing_agent_calendar_events (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references public.listings(id) on delete cascade,
  user_id         uuid not null,
  item_key        text not null,
  google_event_id text not null,
  created_at      timestamptz not null default now(),
  unique (listing_id, user_id, item_key)
);
create index if not exists idx_lace_user on public.listing_agent_calendar_events (user_id);

alter table public.listing_agent_calendar_events enable row level security;
revoke all on public.listing_agent_calendar_events from anon, authenticated;
grant all on public.listing_agent_calendar_events to service_role;

notify pgrst, 'reload schema';
