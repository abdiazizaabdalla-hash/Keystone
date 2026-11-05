-- Brokerage accounts: the tier, seat allowance and complimentary pilot of each brokerage owner. This is Relay's own record of
-- what a brokerage has been granted. It is deliberately separate from Stripe: nothing here creates a subscription or a charge.
-- A brokerage owner with no row here is not under entitlement control yet. Safe to run more than once.
create table if not exists public.brokerage_accounts (
  owner_user_id        uuid primary key,
  tier                 text not null default 'pro' check (tier in ('basic', 'pro')),
  status               text not null check (status in ('pilot', 'pilot_expired', 'converted', 'terminated')),
  extra_seats          integer not null default 0 check (extra_seats >= 0),
  pilot_started_on     date,
  pilot_ends_on        date,
  extension_used       boolean not null default false,
  converted_on         date,
  terminated_on        date,
  upgrade_requested_at timestamptz,
  notes                text check (notes is null or char_length(notes) <= 1000),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- A history of what happened to each account (granted, extended, converted, terminated, notices sent). Nothing is ever deleted.
create table if not exists public.brokerage_account_events (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  kind          text not null,
  ends_on       date,
  actor_user_id uuid,
  note          text check (note is null or char_length(note) <= 1000),
  created_at    timestamptz not null default now()
);
create index if not exists idx_brokerage_account_events_owner on public.brokerage_account_events (owner_user_id, created_at);
-- Each expiry notice goes out once per end date.
create unique index if not exists uq_brokerage_account_notices on public.brokerage_account_events (owner_user_id, kind, ends_on) where kind like 'notice_%';

alter table public.brokerage_accounts enable row level security;
alter table public.brokerage_account_events enable row level security;
revoke all on table public.brokerage_accounts from anon, authenticated;
revoke all on table public.brokerage_account_events from anon, authenticated;
grant select, insert, update, delete on table public.brokerage_accounts to service_role;
grant select, insert, update, delete on table public.brokerage_account_events to service_role;

select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('brokerage_accounts', 'brokerage_account_events') order by table_name, grantee, privilege_type;
