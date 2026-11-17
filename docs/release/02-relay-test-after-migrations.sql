-- relay-test only, run AFTER 01-migrations-all.sql: QuickBooks for brokerages, then reload the API schema cache.

-- QuickBooks Online connection for brokerages: commission statements the agent has agreed to appear in the
-- brokerage's QuickBooks as bills, and a payment is recorded against the bill when the commission is marked paid.
-- Uses the same quickbooks_connections table as coordinators (run add-quickbooks-sync.sql first). Safe to run more than once.

-- 1) Which QuickBooks vendor is each agent (so an agent is never created twice).
create table if not exists public.quickbooks_vendors (
  owner_user_id   uuid not null,
  agent_user_id   uuid not null,
  qb_vendor_id    text not null,
  created_at      timestamptz not null default now(),
  primary key (owner_user_id, agent_user_id)
);

-- 2) What happened to each commission statement.
alter table public.deal_commissions add column if not exists qb_bill_id      text;
alter table public.deal_commissions add column if not exists qb_payment_id   text;
alter table public.deal_commissions add column if not exists qb_sync_status  text;   -- synced | error | skipped | syncing
alter table public.deal_commissions add column if not exists qb_sync_error   text;
alter table public.deal_commissions add column if not exists qb_synced_at    timestamptz;
create index if not exists idx_deal_commissions_qb_status on public.deal_commissions (qb_sync_status);

alter table public.quickbooks_vendors enable row level security;
revoke all on public.quickbooks_vendors from anon, authenticated;
grant all on public.quickbooks_vendors to service_role;

notify pgrst, 'reload schema';

notify pgrst, 'reload schema';
