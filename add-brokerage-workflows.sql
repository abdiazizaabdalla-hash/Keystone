-- Brokerage workflows and managing accounts.
-- 1) A "managing account" is an administrator who runs the brokerage like the owner (not the plan, billing or other administrators).
-- 2) Custom workflows: rules a broker builds themselves (trigger, who is told, escalation, which agents and deal types).
-- 3) Run history gets a label and per-run detail (which files, who was told).
-- Safe to run more than once. Run after add-brokerage-admins.sql and add-brokerage-automations.sql.
alter table public.brokerage_admins drop constraint if exists brokerage_admins_role_check;
alter table public.brokerage_admins add constraint brokerage_admins_role_check check (role in ('viewer', 'reviewer', 'manager', 'managing'));

create table if not exists public.brokerage_workflows (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  name           text not null check (char_length(name) between 1 and 80),
  trigger        text not null check (trigger in ('quiet', 'closing', 'late_steps', 'missing_docs', 'new_deal', 'closed')),
  amount         int not null default 0,
  notify_agent   boolean not null default true,
  -- 'escalate': tell the broker only if still unresolved after escalate_days; 'now': tell the broker at once; 'never'.
  notify_owner   text not null default 'escalate' check (notify_owner in ('escalate', 'now', 'never')),
  escalate_days  int not null default 2 check (escalate_days between 1 and 30),
  agent_ids      uuid[] not null default '{}',
  -- Checklist template names (the deal type). Empty means every deal type.
  deal_types     text[] not null default '{}',
  enabled        boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_brokerage_workflows_owner on public.brokerage_workflows (owner_user_id, created_at);
alter table public.brokerage_workflows enable row level security;
revoke all on table public.brokerage_workflows from anon, authenticated;
grant select, insert, update, delete on table public.brokerage_workflows to service_role;

alter table public.brokerage_automation_runs add column if not exists label text;
alter table public.brokerage_automation_runs add column if not exists workflow_id uuid;
alter table public.brokerage_automation_runs add column if not exists detail jsonb;

notify pgrst, 'reload schema';
