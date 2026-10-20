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

notify pgrst, 'reload schema';
