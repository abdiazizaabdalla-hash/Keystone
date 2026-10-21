-- QuickBooks Online connection: invoices created in Relay appear in the TC's QuickBooks, and payments
-- (including Stripe payments) are recorded against them. Safe to run more than once.
-- Nothing changes for anyone until QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET are set in the environment.

-- 1) One row per TC who connected a QuickBooks company. Tokens are encrypted by the app before they get here.
create table if not exists public.quickbooks_connections (
  tc_user_id         uuid primary key,
  realm_id           text not null,                    -- the QuickBooks company id
  company_name       text,
  environment        text not null default 'production' check (environment in ('production', 'sandbox')),
  refresh_token      text not null,                    -- encrypted
  access_token       text,                             -- encrypted, cached ~1 hour
  access_expires_at  timestamptz,
  status             text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  sync_invoices      boolean not null default true,    -- create invoices in QuickBooks
  sync_payments      boolean not null default true,    -- record payments in QuickBooks
  item_id            text,                             -- the QuickBooks product/service Relay uses on invoice lines
  last_synced_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 2) Which QuickBooks customer is each agent (so an agent is never created twice).
create table if not exists public.quickbooks_customers (
  tc_user_id        uuid not null,
  agent_id          uuid not null,
  qb_customer_id    text not null,
  created_at        timestamptz not null default now(),
  primary key (tc_user_id, agent_id)
);

-- 3) What happened to each invoice.
alter table public.invoices add column if not exists qb_invoice_id   text;
alter table public.invoices add column if not exists qb_payment_id   text;
alter table public.invoices add column if not exists qb_sync_status  text;   -- synced | error | skipped
alter table public.invoices add column if not exists qb_sync_error   text;
alter table public.invoices add column if not exists qb_synced_at    timestamptz;
create index if not exists idx_invoices_qb_status on public.invoices (qb_sync_status);

alter table public.quickbooks_connections enable row level security;
alter table public.quickbooks_customers   enable row level security;
revoke all on public.quickbooks_connections from anon, authenticated;
revoke all on public.quickbooks_customers   from anon, authenticated;
grant all on public.quickbooks_connections to service_role;
grant all on public.quickbooks_customers   to service_role;

notify pgrst, 'reload schema';
