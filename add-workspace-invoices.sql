-- Invoices an agent with their own workspace creates (Phase 2b). Separate from the coordinator's
-- commission invoices (`invoices`), which stay exactly as they are. Safe to re-run.
create table if not exists public.workspace_invoices (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  invoice_number text not null,
  template_key   text,
  title          text not null default '' check (char_length(title) <= 140),
  -- who it is billed to: a contact from the owner's address book, or typed in
  contact_id     uuid,
  bill_to_name   text not null default '' check (char_length(bill_to_name) <= 140),
  bill_to_email  text check (bill_to_email is null or char_length(bill_to_email) <= 254),
  bill_to_address text check (bill_to_address is null or char_length(bill_to_address) <= 400),
  -- only set when a coordinator is on that deal
  transaction_id uuid,
  issue_date     date not null default current_date,
  due_date       date,
  status         text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  memo           text check (memo is null or char_length(memo) <= 2000),
  tax_percent    numeric(5,2) not null default 0 check (tax_percent >= 0 and tax_percent <= 100),
  sent_at        timestamptz,
  paid_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists workspace_invoices_owner_number_uniq on public.workspace_invoices (owner_user_id, invoice_number);
create index if not exists idx_workspace_invoices_owner on public.workspace_invoices (owner_user_id, created_at desc);
create index if not exists idx_workspace_invoices_tx on public.workspace_invoices (transaction_id) where transaction_id is not null;

create table if not exists public.workspace_invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.workspace_invoices(id) on delete cascade,
  position    integer not null default 0,
  description text not null default '' check (char_length(description) <= 300),
  quantity    numeric(10,2) not null default 1 check (quantity >= 0),
  unit_price  numeric(12,2) not null default 0 check (unit_price >= 0 and unit_price < 100000000)
);
create index if not exists idx_workspace_invoice_lines_invoice on public.workspace_invoice_lines (invoice_id, position);

alter table public.workspace_invoices enable row level security;
alter table public.workspace_invoice_lines enable row level security;
revoke all on table public.workspace_invoices from anon, authenticated;
revoke all on table public.workspace_invoice_lines from anon, authenticated;
grant select, insert, update, delete on table public.workspace_invoices to service_role;
grant select, insert, update, delete on table public.workspace_invoice_lines to service_role;
