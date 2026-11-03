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
