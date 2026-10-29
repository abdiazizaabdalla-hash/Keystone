-- Client messaging: a shared board (client + agent + TC) and private threads
-- (client <-> agent, client <-> TC). Run once in the Supabase SQL Editor
-- (safe to re-run). Written only by the server with the service-role key;
-- anon and authenticated get no direct access, like every other table.
--
--   channel 'board'  : visible to every client on the deal, the agent and the TC
--   channel 'agent'  : private between ONE client (link_id) and the agent. The TC cannot read it.
--   channel 'tc'     : private between ONE client (link_id) and the TC. The agent cannot read it.

create table if not exists public.client_messages (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references public.transactions(id) on delete cascade,
  -- the client's progress link. Required for private threads; set on board
  -- posts a client wrote; null on board posts by the agent or TC.
  link_id         uuid references public.external_access_links(id) on delete cascade,
  channel         text not null check (channel in ('board', 'agent', 'tc')),
  sender_type     text not null check (sender_type in ('client', 'agent', 'tc')),
  sender_user_id  uuid references auth.users(id) on delete set null,
  sender_name     text,
  body            text not null check (char_length(body) between 1 and 4000),
  created_at      timestamptz not null default now(),
  check (channel = 'board' or link_id is not null)
);

create index if not exists idx_client_messages_board
  on public.client_messages (transaction_id, channel, created_at);
create index if not exists idx_client_messages_link
  on public.client_messages (link_id, channel, created_at);

alter table public.client_messages enable row level security;
revoke all on table public.client_messages from anon, authenticated;
grant select, insert, update, delete on table public.client_messages to service_role;

notify pgrst, 'reload schema';

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'client_messages' order by ordinal_position;
