-- Brokerage oversight: a brokerage owner (Team or Brokerage plan) invites agents who have their own workspace.
-- Once an agent accepts, the owner can see that agent's deals, deadlines and production, and can edit their deals.
-- Safe to run more than once. Nothing here is used unless the `brokerage` feature is switched on.
create table if not exists public.brokerage_links (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  agent_user_id uuid,
  invited_email text not null check (char_length(invited_email) between 3 and 254),
  status        text not null default 'pending' check (status in ('pending', 'active', 'declined', 'removed', 'left')),
  invited_at    timestamptz not null default now(),
  responded_at  timestamptz,
  ended_at      timestamptz
);
-- One open invite or active link per owner and email.
create unique index if not exists uq_brokerage_links_open on public.brokerage_links (owner_user_id, lower(invited_email)) where status in ('pending', 'active');
-- An agent belongs to one brokerage at a time.
create unique index if not exists uq_brokerage_links_agent_active on public.brokerage_links (agent_user_id) where status = 'active';
create index if not exists idx_brokerage_links_owner on public.brokerage_links (owner_user_id, status);
create index if not exists idx_brokerage_links_agent on public.brokerage_links (agent_user_id, status);
create index if not exists idx_brokerage_links_email on public.brokerage_links (lower(invited_email), status);

alter table public.brokerage_links enable row level security;
revoke all on table public.brokerage_links from anon, authenticated;
grant select, insert, update, delete on table public.brokerage_links to service_role;

select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'brokerage_links' order by grantee, privilege_type;

-- A brokerage owner can share a template (for example the brokerage's IABS) with the agents and team members of the
-- brokerage. Shared templates show up pinned in their Templates screen and on their deals. Safe to run more than once.
alter table public.doc_templates add column if not exists brokerage_shared boolean not null default false;
create index if not exists idx_doc_templates_shared on public.doc_templates (owner_user_id) where brokerage_shared;

-- Private messages between a brokerage owner and one of their agents. Only those two people can read a thread:
-- it is not shown to the rest of the team. Safe to run more than once.
create table if not exists public.brokerage_messages (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  agent_user_id uuid not null,
  sender_id     uuid not null,
  body          text not null check (char_length(body) between 1 and 4000),
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);
create index if not exists idx_brokerage_messages_pair on public.brokerage_messages (owner_user_id, agent_user_id, created_at);
create index if not exists idx_brokerage_messages_agent on public.brokerage_messages (agent_user_id, created_at);

alter table public.brokerage_messages enable row level security;
revoke all on table public.brokerage_messages from anon, authenticated;
grant select, insert, update, delete on table public.brokerage_messages to service_role;

select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'brokerage_messages' order by grantee, privilege_type;
