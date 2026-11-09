-- Auto-0: automation foundation (docs/RELAY_IMPLEMENTATION_PLAN.md section 16.4). Nothing here is used unless the
-- `automation` feature is on. Run on relay-test first; run on production only with the founder's approval, before
-- the flag is ever turned on there. Safe to run more than once. Every table is service-role only (authorization lives
-- in app code, like the rest of Relay).

-- 1. Event log: one row per thing that happened on a deal or listing. dedupe_key makes re-emitting the same event a no-op.
create table if not exists public.transaction_events (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  transaction_id uuid,
  listing_id     uuid,
  type           text not null check (char_length(type) between 1 and 60),
  payload        jsonb not null default '{}'::jsonb,
  dedupe_key     text not null,
  occurred_at    timestamptz not null default now(),
  processed_at   timestamptz,
  check (transaction_id is not null or listing_id is not null)
);
create unique index if not exists uq_transaction_events_dedupe on public.transaction_events (dedupe_key);
create index if not exists idx_transaction_events_unprocessed on public.transaction_events (occurred_at) where processed_at is null;
create index if not exists idx_transaction_events_owner on public.transaction_events (owner_user_id, occurred_at desc);

-- 2. Settings per deal or listing. No row means Off. A row defaults to Draft (nothing is sent without approval).
create table if not exists public.automation_settings (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null,
  transaction_id  uuid,
  listing_id      uuid,
  mode            text not null default 'draft' check (mode in ('off', 'draft', 'auto')),
  features        jsonb not null default '{}'::jsonb,
  follow_up_days  integer not null default 3 check (follow_up_days between 1 and 30),
  quiet_start_hour integer not null default 21 check (quiet_start_hour between 0 and 23),
  quiet_end_hour   integer not null default 7 check (quiet_end_hour between 0 and 23),
  time_zone       text not null default 'America/Chicago',
  daily_send_cap  integer not null default 20 check (daily_send_cap between 0 and 200),
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  check ((transaction_id is not null) <> (listing_id is not null))
);
create unique index if not exists uq_automation_settings_tx on public.automation_settings (transaction_id) where transaction_id is not null;
create unique index if not exists uq_automation_settings_listing on public.automation_settings (listing_id) where listing_id is not null;
create index if not exists idx_automation_settings_owner on public.automation_settings (owner_user_id);

-- 3. Per-account kill switch. paused = true stops every automation action for that account.
create table if not exists public.automation_account_controls (
  owner_user_id uuid primary key,
  paused        boolean not null default false,
  paused_at     timestamptz,
  paused_by     uuid,
  updated_at    timestamptz not null default now()
);

-- 4. Action log: every action proposed, refused or taken. idempotency_key is unique, so a retry or a replayed event
-- can never record (or send) the same action twice.
create table if not exists public.automation_actions (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null,
  transaction_id  uuid,
  listing_id      uuid,
  event_id        uuid references public.transaction_events (id) on delete set null,
  kind            text not null check (char_length(kind) between 1 and 60),
  status          text not null default 'proposed'
                    check (status in ('proposed', 'awaiting_approval', 'approved', 'executed', 'refused', 'failed', 'cancelled', 'deferred')),
  inputs          jsonb not null default '{}'::jsonb,
  result          jsonb,
  refusal_reason  text,
  idempotency_key text not null,
  attempts        integer not null default 0,
  next_attempt_at timestamptz,
  claimed_at      timestamptz,
  claimed_by      text,
  approved_by     uuid,
  approved_at     timestamptz,
  executed_at     timestamptz,
  created_at      timestamptz not null default now(),
  check (transaction_id is not null or listing_id is not null)
);
create unique index if not exists uq_automation_actions_idem on public.automation_actions (idempotency_key);
create index if not exists idx_automation_actions_due on public.automation_actions (next_attempt_at) where status in ('approved', 'deferred');
create index if not exists idx_automation_actions_owner on public.automation_actions (owner_user_id, created_at desc);
create index if not exists idx_automation_actions_tx on public.automation_actions (transaction_id, created_at desc);

-- 5. Approval queue: one row per action that needs a person. Approve, edit, or reject.
create table if not exists public.automation_approvals (
  id            uuid primary key default gen_random_uuid(),
  action_id     uuid not null unique references public.automation_actions (id) on delete cascade,
  owner_user_id uuid not null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  draft         jsonb not null default '{}'::jsonb,
  edited        boolean not null default false,
  decided_by    uuid,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_automation_approvals_pending on public.automation_approvals (owner_user_id, created_at desc) where status = 'pending';

do $$
declare t text;
begin
  foreach t in array array['transaction_events', 'automation_settings', 'automation_account_controls', 'automation_actions', 'automation_approvals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('transaction_events', 'automation_settings', 'automation_account_controls', 'automation_actions', 'automation_approvals')
order by table_name, grantee, privilege_type;
