-- Brokerage automations: the rules a broker switches on to keep the office running (stalled-deal alerts, closing and deadline alerts,
-- missing-document checks, a daily digest, new-agent onboarding and a monthly report). Fixed triggers and conditions; no AI.
-- Three tables: the owner's settings per rule, what has already been sent (so nobody is nagged twice), and a run history.
-- Safe to run more than once. Nothing happens until an owner switches a rule on. Run after add-brokerage-oversight.sql.
create table if not exists public.brokerage_automations (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  kind           text not null check (kind in ('stalled', 'deadlines', 'documents', 'digest', 'onboarding', 'reporting')),
  enabled        boolean not null default false,
  params         jsonb not null default '{}'::jsonb,
  -- Empty means every agent; otherwise only these agents' files are checked.
  agent_ids      uuid[] not null default '{}',
  -- Whether the agent is told too, or only the broker.
  notify_agents  boolean not null default true,
  updated_at     timestamptz not null default now(),
  unique (owner_user_id, kind)
);

create table if not exists public.brokerage_automation_alerts (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  kind          text not null,
  item_key      text not null,
  notified_at   timestamptz not null default now(),
  escalated_at  timestamptz,
  unique (owner_user_id, kind, item_key)
);
create index if not exists idx_brokerage_automation_alerts_owner on public.brokerage_automation_alerts (owner_user_id, kind, notified_at);

create table if not exists public.brokerage_automation_runs (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  kind          text not null,
  ran_at        timestamptz not null default now(),
  status        text not null check (status in ('ok', 'nothing', 'failed')),
  flagged       int not null default 0,
  emails        int not null default 0,
  summary       text not null default ''
);
create index if not exists idx_brokerage_automation_runs_owner on public.brokerage_automation_runs (owner_user_id, ran_at desc);

alter table public.brokerage_automations enable row level security;
alter table public.brokerage_automation_alerts enable row level security;
alter table public.brokerage_automation_runs enable row level security;
revoke all on table public.brokerage_automations, public.brokerage_automation_alerts, public.brokerage_automation_runs from anon, authenticated;
grant select, insert, update, delete on table public.brokerage_automations, public.brokerage_automation_alerts, public.brokerage_automation_runs to service_role;

notify pgrst, 'reload schema';
