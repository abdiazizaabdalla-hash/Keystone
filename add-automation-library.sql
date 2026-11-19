-- Automation Library (Auto-1, phase 1): reusable workflows (templates) and the independent copies (instances) applied to deals
-- and listings. Run after add-automation-foundation.sql. Safe to run more than once. Run on relay-test first; production only
-- with the founder's approval, before the automation flag is turned on there. Service-role only, like the rest of Relay.

create table if not exists public.automation_templates (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  name           text not null check (char_length(name) between 1 and 120),
  description    text not null default '' check (char_length(description) <= 500),
  category       text not null check (category in ('transaction', 'listing')),
  trigger_type   text not null,
  steps          jsonb not null,
  active         boolean not null default true,
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_automation_templates_owner on public.automation_templates (owner_user_id, category);

-- A copy of a template running on one deal or listing. It keeps its own snapshot of the steps, so editing the template later
-- never changes work already running; "update copies" is an explicit action.
create table if not exists public.automation_instances (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid references public.automation_templates (id) on delete set null,
  owner_user_id    uuid not null,
  transaction_id   uuid references public.transactions (id) on delete cascade,
  listing_id       uuid references public.listings (id) on delete cascade,
  name             text not null,
  category         text not null check (category in ('transaction', 'listing')),
  trigger_type     text not null,
  steps            jsonb not null,
  template_version integer not null default 1,
  status           text not null default 'active' check (status in ('active', 'paused', 'removed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((transaction_id is not null) <> (listing_id is not null))
);
create index if not exists idx_automation_instances_deal on public.automation_instances (transaction_id) where transaction_id is not null;
create index if not exists idx_automation_instances_listing on public.automation_instances (listing_id) where listing_id is not null;
create index if not exists idx_automation_instances_template on public.automation_instances (template_id);
create index if not exists idx_automation_instances_active on public.automation_instances (owner_user_id) where status = 'active';
-- The same template is applied to a given deal or listing only once at a time.
create unique index if not exists uq_automation_instances_tx on public.automation_instances (template_id, transaction_id) where status <> 'removed' and template_id is not null and transaction_id is not null;
create unique index if not exists uq_automation_instances_listing on public.automation_instances (template_id, listing_id) where status <> 'removed' and template_id is not null and listing_id is not null;

-- Every action a copy takes lands in the existing action log, tagged with its copy and step.
alter table public.automation_actions add column if not exists instance_id uuid references public.automation_instances (id) on delete set null;
alter table public.automation_actions add column if not exists step_id text;
create index if not exists idx_automation_actions_instance on public.automation_actions (instance_id, created_at desc) where instance_id is not null;

do $$
declare t text;
begin
  foreach t in array array['automation_templates', 'automation_instances'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('automation_templates', 'automation_instances')
order by table_name, grantee, privilege_type;
