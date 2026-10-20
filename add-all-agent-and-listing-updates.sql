-- Relay TC: everything added for listings, agents, messages and e-signing since the last database update.
-- Paste the whole thing into the Supabase SQL editor and run it once. Every part is safe to run again.
-- Needs the earlier listing scripts (add-listings, add-listing-extras, add-listing-documents, add-listing-round3) to have been run.

-- ===== add-listing-agent-calendar.sql =====
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


-- ===== add-listing-readiness.sql =====
-- "Ready to list" card: remembers which required documents a listing does not need
-- (for example a new-construction home with no seller disclosure).
-- Safe to run more than once.

alter table public.listings add column if not exists docs_not_needed text[] not null default '{}';


-- ===== add-listing-esign.sql =====
-- E-signature for listing documents (same signing flow as deals).
-- Safe to run more than once.
--
-- A signing request now belongs to a deal OR a listing. Existing requests are untouched.

alter table public.signing_requests alter column transaction_id drop not null;

alter table public.signing_requests add column if not exists listing_id uuid references public.listings(id) on delete cascade;
alter table public.signing_requests add column if not exists listing_document_id uuid;
alter table public.signing_requests add column if not exists signed_listing_document_id uuid;
create index if not exists idx_signing_requests_listing_id on public.signing_requests (listing_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'signing_requests_target_chk') then
    alter table public.signing_requests
      add constraint signing_requests_target_chk check (transaction_id is not null or listing_id is not null);
  end if;
end $$;

-- Marks the signed copy that signing produces, and any file already signed outside Relay.
alter table public.listing_documents add column if not exists is_signed boolean not null default false;


-- ===== add-direct-messages.sql =====
-- General messages between a coordinator and an agent (not tied to a deal or a listing).
-- Deal messages (messages) and listing messages (listing_comments) stay where they are.
-- Safe to run more than once.

create table if not exists public.direct_messages (
  id          uuid primary key default gen_random_uuid(),
  -- The coordinator who owns the agent record, and the agent's login email (lowercase) -- one conversation per pair.
  tc_user_id  uuid not null,
  agent_email text not null,
  sender_id   uuid not null,
  -- tc | agent
  sender_role text not null check (sender_role in ('tc', 'agent')),
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists idx_direct_messages_pair on public.direct_messages (tc_user_id, agent_email, created_at);
create index if not exists idx_direct_messages_agent on public.direct_messages (agent_email, created_at);

alter table public.direct_messages enable row level security;
revoke all on table public.direct_messages from anon, authenticated;
grant select, insert, update, delete on table public.direct_messages to service_role;


-- ===== add-listing-agent-access.sql =====
-- Lets the listing agent add people to their listing from the agent portal (and remove the ones they added).
-- Safe to run more than once. Until it is run, agents can still see contacts but cannot add or remove any.
alter table public.listing_contacts add column if not exists added_by_agent boolean not null default false;

-- ===== add-agent-notice-seen.sql =====
alter table public.transaction_agents add column if not exists notice_seen boolean not null default true;
alter table public.transaction_agents alter column notice_seen set default false;

notify pgrst, 'reload schema';
