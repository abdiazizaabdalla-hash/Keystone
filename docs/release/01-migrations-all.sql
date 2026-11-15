-- RELAY TC: production migration for the TC launch (templates, other invoices, archive, email log, automation, and the dark agent/brokerage tables).
-- Generated from the individual add-*.sql files in dependency order. Every statement is additive or safe to re-run.
-- Rehearsed against a copy of the production schema snapshot (docs/schema-snapshot.sql, 2026-11-02): applies cleanly, and a second run changes nothing.
-- Runs as ONE transaction: if anything fails, nothing is applied. Take a backup first. Do NOT run add-automation-schedule.sql here (see docs/RELEASE_RUNBOOK_TC_LAUNCH.md).
-- Data touched: remove-starter-letters.sql archives two old starter letter templates; add-commission-estimates.sql backfills confirmed_at on existing commission rows (none exist in production today).
begin;

-- ======================================================================
-- add-workspace-invoices.sql
-- ======================================================================
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

-- ======================================================================
-- add-templates-automation.sql
-- ======================================================================
-- Document and email templates (filtered by state), automatic rules (for example "after closing"), and the
-- approval queue they feed. Also gives each deal a property state. Safe to re-run.

alter table public.transactions add column if not exists property_state text;
do $$ begin
  alter table public.transactions add constraint transactions_property_state_check check (property_state is null or property_state ~ '^[A-Z]{2}$');
exception when duplicate_object then null; end $$;

create table if not exists public.doc_templates (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  -- email: subject + body sent to people on a deal; letter: body made into a PDF for the deal; form: an uploaded file (your own licensed form)
  kind          text not null check (kind in ('email', 'letter', 'form')),
  name          text not null check (char_length(name) between 1 and 140),
  description   text check (description is null or char_length(description) <= 500),
  category      text not null default 'general' check (char_length(category) <= 40),
  -- two-letter state codes this template is for; empty means every state
  states        text[] not null default '{}',
  subject       text check (subject is null or char_length(subject) <= 200),
  body          text check (body is null or char_length(body) <= 20000),
  file_name     text,
  storage_path  text,
  content_type  text,
  file_size     integer,
  -- set when this row was copied from the built-in starter pack
  starter_key   text,
  archived      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists doc_templates_owner_starter_uniq on public.doc_templates (owner_user_id, starter_key) where starter_key is not null;
create index if not exists idx_doc_templates_owner on public.doc_templates (owner_user_id, archived, kind);

create table if not exists public.template_rules (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  template_id    uuid not null references public.doc_templates(id) on delete cascade,
  enabled        boolean not null default true,
  -- deal_closed: the day the deal is marked Closed; closing_date / acceptance_date: that date on the deal
  trigger_event  text not null check (trigger_event in ('deal_closed', 'closing_date', 'acceptance_date')),
  -- days after the trigger (negative means before)
  offset_days    integer not null default 0 check (offset_days between -365 and 3650),
  repeat_yearly  boolean not null default false,
  repeat_years   integer not null default 5 check (repeat_years between 1 and 20),
  -- who receives it: deal contact roles such as Buyer, Seller, plus 'agent'
  recipient_roles text[] not null default '{Buyer,Seller}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_template_rules_owner on public.template_rules (owner_user_id, enabled);

create table if not exists public.template_runs (
  id                    uuid primary key default gen_random_uuid(),
  owner_user_id         uuid not null,
  rule_id               uuid references public.template_rules(id) on delete set null,
  template_id           uuid references public.doc_templates(id) on delete set null,
  transaction_id        uuid not null,
  due_on                date not null,
  -- pending: waiting for approval; sent: approved and delivered (or put in the local outbox); dismissed; failed
  status                text not null default 'pending' check (status in ('pending', 'sent', 'dismissed', 'failed')),
  kind                  text not null check (kind in ('email', 'letter', 'form')),
  subject               text,
  body                  text,
  recipients            jsonb not null default '[]',
  outbox_only           boolean not null default false,
  error                 text,
  generated_document_id uuid,
  decided_at            timestamptz,
  sent_at               timestamptz,
  created_at            timestamptz not null default now()
);
create unique index if not exists template_runs_rule_deal_due_uniq on public.template_runs (rule_id, transaction_id, due_on) where rule_id is not null;
create index if not exists idx_template_runs_owner_status on public.template_runs (owner_user_id, status, due_on);
create index if not exists idx_template_runs_tx on public.template_runs (transaction_id);

alter table public.doc_templates enable row level security;
alter table public.template_rules enable row level security;
alter table public.template_runs enable row level security;
revoke all on table public.doc_templates from anon, authenticated;
revoke all on table public.template_rules from anon, authenticated;
revoke all on table public.template_runs from anon, authenticated;
grant select, insert, update, delete on table public.doc_templates to service_role;
grant select, insert, update, delete on table public.template_rules to service_role;
grant select, insert, update, delete on table public.template_runs to service_role;

-- ======================================================================
-- add-email-outbox.sql
-- ======================================================================
-- Local/test "outbox": when RELAY_OUTBOX_ONLY=1 the app records the emails it would have sent here instead of
-- sending them, so automation can be tried safely. Production never sets that, so nothing is ever written to this
-- table there. Safe to re-run.
create table if not exists public.email_outbox (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  transaction_id uuid,
  source         text not null default 'manual',
  to_emails      text[] not null default '{}',
  cc_emails      text[] not null default '{}',
  bcc_emails     text[] not null default '{}',
  reply_to       text,
  from_name      text,
  subject        text not null,
  body           text not null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_email_outbox_owner on public.email_outbox (owner_user_id, created_at desc);

alter table public.email_outbox enable row level security;
revoke all on table public.email_outbox from anon, authenticated;
grant select, insert, update, delete on table public.email_outbox to service_role;

select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'email_outbox'
order by grantee, privilege_type;

-- ======================================================================
-- add-templates-last-used.sql
-- ======================================================================
-- Remembers when each template was last used on a deal, so the Documents tab can show "recently used" for quick access.
-- Safe to re-run.
alter table public.doc_templates add column if not exists last_used_at timestamptz;
alter table public.doc_templates add column if not exists use_count integer not null default 0;
create index if not exists idx_doc_templates_recent on public.doc_templates (owner_user_id, last_used_at desc) where last_used_at is not null;

-- ======================================================================
-- add-trec-catalog.sql
-- ======================================================================
-- Texas: a catalog of TREC's official forms (name, form number, effective date and a link to TREC's own page for each).
-- Relay stores no copy of any TREC form; it keeps this list so it can link to TREC and notice when a form is revised.
-- Also: pins (a person's pinned folders, templates and TREC forms). Safe to re-run.
create table if not exists public.trec_forms (
  slug             text primary key,
  name             text not null,
  form_id          text not null,
  section          text not null check (section in ('contracts', 'addenda', 'other')),
  effective_date   date,
  previous_form_id text,
  changed_at       timestamptz,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  removed          boolean not null default false
);
create table if not exists public.trec_catalog_status (
  id              integer primary key default 1 check (id = 1),
  last_checked_at timestamptz,
  last_ok_at      timestamptz,
  last_error      text
);
create table if not exists public.template_pins (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  kind          text not null check (kind in ('folder', 'template', 'trec')),
  ref           text not null,
  created_at    timestamptz not null default now(),
  unique (owner_user_id, kind, ref)
);
create index if not exists idx_template_pins_owner on public.template_pins (owner_user_id);

alter table public.trec_forms enable row level security;
alter table public.trec_catalog_status enable row level security;
alter table public.template_pins enable row level security;
revoke all on table public.trec_forms from anon, authenticated;
revoke all on table public.trec_catalog_status from anon, authenticated;
revoke all on table public.template_pins from anon, authenticated;
grant select, insert, update, delete on table public.trec_forms to service_role;
grant select, insert, update, delete on table public.trec_catalog_status to service_role;
grant select, insert, update, delete on table public.template_pins to service_role;

-- ======================================================================
-- add-template-folders.sql
-- ======================================================================
-- Custom folders for commonly used documents, plus pinning of official state sources and custom folders.
-- Safe to run more than once.
create table if not exists public.template_folders (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  name          text not null check (char_length(name) between 1 and 60),
  created_at    timestamptz not null default now()
);
create unique index if not exists uq_template_folders_owner_name on public.template_folders (owner_user_id, lower(name));

create table if not exists public.template_folder_items (
  id            uuid primary key default gen_random_uuid(),
  folder_id     uuid not null references public.template_folders (id) on delete cascade,
  owner_user_id uuid not null,
  kind          text not null check (kind in ('template', 'trec', 'source')),
  ref           text not null,
  created_at    timestamptz not null default now(),
  unique (folder_id, kind, ref)
);
create index if not exists idx_template_folder_items_folder on public.template_folder_items (folder_id);

alter table public.template_pins drop constraint if exists template_pins_kind_check;
alter table public.template_pins add constraint template_pins_kind_check check (kind in ('folder', 'template', 'trec', 'source', 'custom'));

alter table public.template_folders enable row level security;
alter table public.template_folder_items enable row level security;
revoke all on table public.template_folders from anon, authenticated;
revoke all on table public.template_folder_items from anon, authenticated;
grant select, insert, update, delete on table public.template_folders to service_role;
grant select, insert, update, delete on table public.template_folder_items to service_role;

-- ======================================================================
-- add-brokerage-oversight.sql
-- ======================================================================
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

-- Commission splits. The brokerage owner can keep a default split per agent, and proposes a split on each deal; the agent
-- accepts it (or asks for a change) before it counts. No money moves through Relay at this stage: the owner records when
-- it was paid. Safe to run more than once.
alter table public.brokerage_links add column if not exists default_split_type  text check (default_split_type in ('percent', 'flat_agent', 'flat_brokerage'));
alter table public.brokerage_links add column if not exists default_split_value numeric(12, 2) check (default_split_value is null or default_split_value >= 0);

create table if not exists public.deal_commissions (
  id                  uuid primary key default gen_random_uuid(),
  transaction_id      uuid not null references public.transactions(id) on delete cascade,
  owner_user_id       uuid not null,
  agent_user_id       uuid not null,
  statement_number    text not null,
  gross_cents         bigint not null check (gross_cents > 0),
  split_type          text not null check (split_type in ('percent', 'flat_agent', 'flat_brokerage')),
  split_value         numeric(12, 2) not null check (split_value >= 0),
  deductions          jsonb not null default '[]'::jsonb,
  agent_net_cents     bigint not null check (agent_net_cents >= 0),
  brokerage_net_cents bigint not null check (brokerage_net_cents >= 0),
  -- proposed: waiting for the agent; change_requested: the agent asked for a change; accepted; paid; void
  status              text not null default 'proposed' check (status in ('proposed', 'change_requested', 'accepted', 'paid', 'void')),
  change_note         text check (change_note is null or char_length(change_note) <= 1000),
  -- the agent's answer at closing: have the payment handled through Relay, or outside it (Relay payments are not switched on yet)
  payment_preference  text check (payment_preference is null or payment_preference in ('relay', 'outside')),
  proposed_at         timestamptz not null default now(),
  accepted_at         timestamptz,
  paid_on             date,
  paid_note           text check (paid_note is null or char_length(paid_note) <= 500),
  updated_at          timestamptz not null default now()
);
create unique index if not exists uq_deal_commissions_transaction on public.deal_commissions (transaction_id);
create unique index if not exists uq_deal_commissions_statement on public.deal_commissions (owner_user_id, statement_number);
create index if not exists idx_deal_commissions_owner on public.deal_commissions (owner_user_id, status);
create index if not exists idx_deal_commissions_agent on public.deal_commissions (agent_user_id, status);

alter table public.deal_commissions enable row level security;
revoke all on table public.deal_commissions from anon, authenticated;
grant select, insert, update, delete on table public.deal_commissions to service_role;

select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'deal_commissions' and grantee = 'service_role' order by privilege_type;

-- ======================================================================
-- add-commission-estimates.sql
-- ======================================================================
-- Commission statements that start as an estimate (Step 1 of the commission workflow).
--
-- Before this, a statement could only exist once someone typed in a gross commission. Now:
--   * a statement can exist with no figures yet (status 'estimate'), built from the agent's base terms; the brokerage owner
--     replaces it with the confirmed gross from the closing documents, which moves it to 'proposed' for the agent to review;
--   * the brokerage's base terms for an agent can carry default fees and an optional cap (with how it resets);
--   * each statement records who confirmed it and when, and keeps the cap rule that applied when it was made.
-- Nothing existing changes: every statement already in the table keeps its status, figures and dates, and is marked as
-- confirmed by its brokerage owner. Safe to run more than once. Run after add-brokerage-oversight.sql.

-- A statement with no confirmed figure has no gross and no net yet.
alter table public.deal_commissions alter column gross_cents drop not null;
alter table public.deal_commissions alter column agent_net_cents drop not null;
alter table public.deal_commissions alter column brokerage_net_cents drop not null;

-- The new 'estimate' status, and the rule that every other status has a gross.
alter table public.deal_commissions drop constraint if exists deal_commissions_status_check;
alter table public.deal_commissions add constraint deal_commissions_status_check
  check (status in ('estimate', 'proposed', 'change_requested', 'accepted', 'paid', 'void'));
alter table public.deal_commissions drop constraint if exists deal_commissions_gross_when_confirmed;
alter table public.deal_commissions add constraint deal_commissions_gross_when_confirmed
  check (status in ('estimate', 'void') or (gross_cents is not null and agent_net_cents is not null and brokerage_net_cents is not null));

-- Who confirmed the gross, and when; and the cap rule the statement was made under (kept so cap tracking can be computed later).
alter table public.deal_commissions add column if not exists confirmed_at timestamptz;
alter table public.deal_commissions add column if not exists confirmed_by uuid;
alter table public.deal_commissions add column if not exists cap_snapshot jsonb;

-- Existing statements were all made from a figure the owner typed: treat them as confirmed by the owner. Statuses are not touched.
update public.deal_commissions
   set confirmed_at = coalesce(accepted_at, proposed_at), confirmed_by = owner_user_id
 where confirmed_at is null and confirmed_by is null and status <> 'estimate' and gross_cents is not null;

-- The brokerage's base terms for an agent: default fees (each { label, amount, when }) and an optional cap.
alter table public.brokerage_links add column if not exists default_fees jsonb not null default '[]'::jsonb;
alter table public.brokerage_links add column if not exists cap_cents bigint;
alter table public.brokerage_links add column if not exists cap_reset text;
alter table public.brokerage_links add column if not exists cap_start date;
alter table public.brokerage_links drop constraint if exists brokerage_links_cap_check;
alter table public.brokerage_links add constraint brokerage_links_cap_check
  check ((cap_cents is null and cap_reset is null) or (cap_cents > 0 and cap_reset in ('calendar_year', 'anniversary')));

select column_name, is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'deal_commissions' and column_name in ('gross_cents', 'agent_net_cents', 'brokerage_net_cents', 'confirmed_at', 'confirmed_by', 'cap_snapshot')
 order by column_name;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Commission rate (added to Step 1): the commission is a percentage of the sale price (or a flat fee), set per agent by the brokerage
-- and changeable on each deal. A statement is made when the deal closes, and its ESTIMATE is sale price x rate; the owner confirms the
-- actual gross from the closing documents. Additive and safe to run more than once.
alter table public.brokerage_links add column if not exists default_commission_type text;
alter table public.brokerage_links add column if not exists default_commission_value numeric(14, 4);
alter table public.brokerage_links drop constraint if exists brokerage_links_commission_check;
alter table public.brokerage_links add constraint brokerage_links_commission_check
  check ((default_commission_type is null and default_commission_value is null)
      or (default_commission_type in ('percent', 'flat') and default_commission_value is not null and default_commission_value >= 0));

alter table public.deal_commissions add column if not exists commission_type text;
alter table public.deal_commissions add column if not exists commission_value numeric(14, 4);
alter table public.deal_commissions add column if not exists estimated_gross_cents bigint;
alter table public.deal_commissions drop constraint if exists deal_commissions_commission_check;
alter table public.deal_commissions add constraint deal_commissions_commission_check
  check ((commission_type is null and commission_value is null)
      or (commission_type in ('percent', 'flat') and commission_value is not null and commission_value >= 0));

-- ======================================================================
-- add-brokerage-file-review.sql
-- ======================================================================
-- Brokerage file review: the owner chooses which documents every closed file must contain, then marks each file reviewed or
-- flags it for follow-up. Read-only for agents (they are told when a file is flagged). Safe to run more than once.
-- Nothing here is used unless the `brokerage` feature is switched on.
create table if not exists public.brokerage_file_requirements (
  owner_user_id  uuid primary key,
  document_types text[] not null default '{}',
  updated_at     timestamptz not null default now()
);

create table if not exists public.brokerage_file_reviews (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  status         text not null check (status in ('reviewed', 'flagged')),
  note           text check (note is null or char_length(note) <= 500),
  reviewed_at    timestamptz not null default now(),
  unique (owner_user_id, transaction_id)
);
create index if not exists idx_brokerage_file_reviews_owner on public.brokerage_file_reviews (owner_user_id, status);

alter table public.brokerage_file_requirements enable row level security;
alter table public.brokerage_file_reviews enable row level security;
revoke all on table public.brokerage_file_requirements from anon, authenticated;
revoke all on table public.brokerage_file_reviews from anon, authenticated;
grant select, insert, update, delete on table public.brokerage_file_requirements to service_role;
grant select, insert, update, delete on table public.brokerage_file_reviews to service_role;

select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('brokerage_file_requirements', 'brokerage_file_reviews') order by table_name, grantee, privilege_type;

-- ======================================================================
-- add-brokerage-accounts.sql
-- ======================================================================
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

-- ======================================================================
-- remove-starter-letters.sql
-- ======================================================================
-- The built-in starter pack no longer has letters (the closing summary letter and the client welcome letter were not being used).
-- This hides the copies that were installed in accounts from the old pack. They are archived, not deleted, so anything someone
-- edited can still be found under archived templates, and documents already made from them are untouched.
-- Run once in the Supabase SQL editor. Safe to run again.
update public.doc_templates
set archived = true, updated_at = now()
where starter_key in ('letter_closing_summary', 'letter_welcome_client') and archived = false;

select count(*) as starter_letters_still_showing from public.doc_templates
where starter_key in ('letter_closing_summary', 'letter_welcome_client') and archived = false;

-- ======================================================================
-- add-template-library.sql
-- ======================================================================
-- Template library: PDF Templates (by state and document category) and State Resources (links).
-- Safe to run more than once. Nothing existing is changed or removed.

-- Where a PDF template files itself in a deal's Documents when it is added (same categories as the deal Documents tab).
alter table public.doc_templates add column if not exists document_category text not null default 'other';
alter table public.doc_templates add column if not exists document_type text not null default 'General';

-- A person's own links to a state's forms pages (shown under State Resources; never attached to a deal).
create table if not exists public.template_state_links (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  state         text not null check (char_length(state) = 2),
  label         text not null check (char_length(label) between 1 and 140),
  url           text not null check (char_length(url) between 8 and 500),
  created_at    timestamptz not null default now()
);
create index if not exists idx_template_state_links_owner on public.template_state_links (owner_user_id, state);

alter table public.template_state_links enable row level security;
revoke all on table public.template_state_links from anon, authenticated;
grant select, insert, update, delete on table public.template_state_links to service_role;

notify pgrst, 'reload schema';

-- ======================================================================
-- add-workspace-invoice-refunds.sql
-- ======================================================================
-- Refund tracking for invoices an agent sends from their workspace (the same idea as add-invoice-refunds.sql for coordinator invoices).
-- When a payment is refunded in the sender's Stripe dashboard, the Connect webhook records it here so totals stop counting the money.
-- Safe to re-run.
alter table public.workspace_invoices
  add column if not exists refunded boolean not null default false,
  add column if not exists refunded_at timestamptz,
  add column if not exists refunded_amount numeric(12,2);

-- ======================================================================
-- add-listing-invoices.sql
-- ======================================================================
-- Listing fees and editable invoices. Safe to re-run.
--  * agents.listing_fee: an optional default fee for listing an agent's property (set on the agent's profile).
--  * invoices can now bill a listing (kind = 'listing', listing_id) instead of a deal, so transaction_id becomes optional.
--  * invoices remember how their total was built (flat fee, percentage fee, adjustment/discount and its note) so a coordinator
--    can change the price when they create one (a promotion, say) and the PDF and screens still show the right breakdown.
alter table public.agents add column if not exists listing_fee numeric(12,2);

alter table public.invoices alter column transaction_id drop not null;
alter table public.invoices
  add column if not exists kind text not null default 'transaction',
  add column if not exists listing_id uuid,
  add column if not exists description text,
  add column if not exists flat_fee numeric(12,2),
  add column if not exists percent_fee numeric(12,2),
  add column if not exists adjustment numeric(12,2),
  add column if not exists adjustment_note text;

-- One invoice per listing and agent record.
create unique index if not exists invoices_listing_agent_uniq on public.invoices (listing_id, agent_id) where listing_id is not null;
create index if not exists idx_invoices_listing on public.invoices (listing_id) where listing_id is not null;

-- ======================================================================
-- add-listing-coordinators.sql
-- ======================================================================
-- An agent with a workspace can invite a transaction coordinator onto one of their own listings (the listing equivalent of
-- a deal's coordinator invite). The listing stays the agent's; once the coordinator accepts it appears in their Listings list
-- and they work it with the agent. Safe to re-run.
create table if not exists public.listing_coordinators (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  email text not null,
  invited_by uuid not null,
  coordinator_user_id uuid,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index if not exists listing_coordinators_listing_email_uniq on public.listing_coordinators (listing_id, lower(email));
create index if not exists idx_listing_coordinators_user on public.listing_coordinators (coordinator_user_id) where coordinator_user_id is not null;
create index if not exists idx_listing_coordinators_email on public.listing_coordinators (lower(email));
alter table public.listing_coordinators enable row level security;

-- ======================================================================
-- add-agent-services.sql
-- ======================================================================
-- Extra things a coordinator charges an agent besides the standard fees (e.g. "Rush file", "Amendment", "Closing gift"):
-- a list of { id, name, amount } kept on the agent's profile. They show in the invoice's Service dropdown. Safe to re-run.
alter table public.agents add column if not exists services jsonb not null default '[]'::jsonb;

-- ======================================================================
-- add-team-reports.sql
-- ======================================================================
-- Team reports: scheduled activity reports for a team owner, saved in Relay so each week or month can be downloaded again.
-- Safe to re-run. Run in the Supabase SQL editor.
--  * tasks.completed_at: when a checklist step was ticked, so a report can say which steps were completed in its period.
--  * team_report_settings: how often to generate (off / weekly / monthly) and the notes to put in every report's Notes tab.
--  * team_reports: one row per generated report (a snapshot of the data plus that report's own notes).
alter table public.tasks add column if not exists completed_at timestamptz;

create table if not exists public.team_report_settings (
  owner_user_id uuid primary key,
  team_id       uuid references public.teams(id) on delete cascade,
  cadence       text not null default 'off' check (cadence in ('off', 'weekly', 'monthly')),
  notes         text check (notes is null or char_length(notes) <= 5000),
  updated_at    timestamptz not null default now()
);

create table if not exists public.team_reports (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  team_id       uuid references public.teams(id) on delete cascade,
  cadence       text not null default 'manual' check (cadence in ('manual', 'weekly', 'monthly')),
  period_start  date not null,
  period_end    date not null,
  generated_at  timestamptz not null default now(),
  notes         text check (notes is null or char_length(notes) <= 5000),
  data          jsonb not null default '{}'::jsonb
);
create index if not exists idx_team_reports_owner on public.team_reports (owner_user_id, period_end desc);
-- One scheduled report per owner, cadence and period (the daily job can run again without making a second one).
create unique index if not exists team_reports_scheduled_uniq on public.team_reports (owner_user_id, cadence, period_start) where cadence <> 'manual';

alter table public.team_report_settings enable row level security;
alter table public.team_reports enable row level security;
revoke all on table public.team_report_settings from anon, authenticated;
revoke all on table public.team_reports from anon, authenticated;
grant select, insert, update, delete on table public.team_report_settings to service_role;
grant select, insert, update, delete on table public.team_reports to service_role;

-- ======================================================================
-- add-brokerage-permissions.sql
-- ======================================================================
-- Per-agent permission on a brokerage link: may the brokerage owner open this agent's document files (contracts, disclosures,
-- uploads), or only see the document names? The agent controls it from their Brokerage page and sees it before accepting.
-- Default is on, which is how the owner's deal and listing pages already work; an agent can switch it off any time.
-- Safe to re-run. Run after add-brokerage-oversight.sql.
alter table public.brokerage_links add column if not exists can_open_documents boolean not null default true;

-- ======================================================================
-- add-listing-agent-notice.sql
-- ======================================================================
-- Remembers whether an agent has already seen the "your coordinator added you to a listing" banner, so it shows once.
-- Safe to run more than once. Listings already shared with agents count as seen.
alter table public.listings add column if not exists agent_notice_seen boolean not null default true;
alter table public.listings alter column agent_notice_seen set default false;

notify pgrst, 'reload schema';

-- ======================================================================
-- add-automation-foundation.sql
-- ======================================================================
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

-- ======================================================================
-- add-automation-owner-actions.sql
-- ======================================================================
-- Auto-0 follow-up: lets an action belong to the account instead of one deal (the daily briefing goes to the owner, not to a
-- deal). Run after add-automation-foundation.sql. Safe to run more than once. Run on relay-test first.
alter table public.automation_actions drop constraint if exists automation_actions_check;

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.automation_actions'::regclass and contype = 'c'
order by conname;

-- ======================================================================
-- add-automation-library.sql
-- ======================================================================
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

-- ======================================================================
-- add-transaction-archive.sql
-- ======================================================================
-- Archive: a transaction that did not close (fell through, cancelled, duplicate...) leaves everyday work without being deleted.
-- It is a separate flag from the stage, so the checklist-driven stage can never overwrite it, and it can be undone.
-- Safe to run more than once. Nothing changes for any existing deal.
alter table public.transactions add column if not exists archived_at    timestamptz;
alter table public.transactions add column if not exists archive_reason text;
alter table public.transactions add column if not exists archive_note   text;
alter table public.transactions add column if not exists archived_by    uuid;

create index if not exists idx_transactions_archived on public.transactions (tc_user_id) where archived_at is not null;

notify pgrst, 'reload schema';

-- ======================================================================
-- add-deal-email-log.sql
-- ======================================================================
-- One record of every email sent from a deal or listing, whichever way it was sent (the Email button on a step, a template,
-- or an automation). It is the communication history, and it is how an automatic email knows a person already sent the same
-- thing. Safe to run more than once. Nothing changes for existing data.
create table if not exists public.deal_email_log (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  transaction_id uuid references public.transactions(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete cascade,
  task_id uuid,
  source text not null,                 -- step_button | template | automation
  to_emails text[] not null default '{}',
  subject text not null,
  mode text not null default 'sent',    -- sent | outbox
  sent_at timestamptz not null default now()
);
create index if not exists idx_deal_email_log_tx on public.deal_email_log (transaction_id, sent_at desc) where transaction_id is not null;
create index if not exists idx_deal_email_log_listing on public.deal_email_log (listing_id, sent_at desc) where listing_id is not null;
create index if not exists idx_deal_email_log_task on public.deal_email_log (task_id) where task_id is not null;

alter table public.deal_email_log enable row level security;
revoke all on table public.deal_email_log from anon, authenticated;
grant select, insert, update, delete on table public.deal_email_log to service_role;

notify pgrst, 'reload schema';

-- ======================================================================
-- add-task-automation.sql
-- ======================================================================
-- Task-driven automation: an automation can watch one checklist step ("when Inspection scheduling is completed..."),
-- so it needs to remember which step. Additive and safe to run more than once; existing automations are untouched.
alter table public.automation_templates add column if not exists trigger_task text;
alter table public.automation_instances add column if not exists trigger_task text;

notify pgrst, 'reload schema';

-- ======================================================================
-- add-task-documents.sql
-- ======================================================================
-- Documents and the checklist: when a document that a step was waiting for arrives, the step records it as received and
-- waits for a person to review it. Nothing is marked complete. Additive; safe to run more than once.
alter table public.tasks add column if not exists received_at timestamptz;
alter table public.tasks add column if not exists received_document_id uuid;
alter table public.tasks add column if not exists needs_review boolean not null default false;

notify pgrst, 'reload schema';

-- ======================================================================
-- add-listing-archive.sql
-- ======================================================================
-- Archive: a listing that did not go anywhere (seller changed their mind, expired, duplicate...) leaves everyday work
-- without being deleted. It keeps its checklist, offers and documents, and can be restored to the status it had.
-- Safe to run more than once. Nothing changes for any existing listing.
alter table public.listings add column if not exists archived_at         timestamptz;
alter table public.listings add column if not exists archive_reason      text;
alter table public.listings add column if not exists archive_note        text;
alter table public.listings add column if not exists archived_by         uuid;
alter table public.listings add column if not exists archive_prev_status text;

create index if not exists idx_listings_archived on public.listings (tc_user_id) where archived_at is not null;

notify pgrst, 'reload schema';


-- ======================================================================
-- add-brokerage-document-lists.sql
-- ======================================================================
-- Brokerage Pro: more than one required-document list. The list on brokerage_file_requirements stays the default for every file;
-- each list here applies to files whose checklist template is named in template_names (for example "Cash" or "Condo").
-- Safe to run more than once. Run after add-brokerage-file-review.sql. Nothing changes until an owner adds a list.
create table if not exists public.brokerage_document_lists (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  name           text not null check (char_length(name) between 1 and 60),
  template_names text[] not null default '{}',
  document_types text[] not null default '{}',
  position       int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_brokerage_document_lists_owner on public.brokerage_document_lists (owner_user_id, position);

alter table public.brokerage_document_lists enable row level security;
revoke all on table public.brokerage_document_lists from anon, authenticated;
grant select, insert, update, delete on table public.brokerage_document_lists to service_role;

notify pgrst, 'reload schema';


-- ======================================================================
-- add-brokerage-admins.sql
-- ======================================================================
-- Brokerage administrators: people the brokerage owner lets help run the brokerage, each with a role that limits what they can do.
-- Brokerage Basic: one extra administrator with the Manager role. Brokerage Pro: up to five, any role.
-- An administrator signs in with their own Relay login (the email the owner entered); nothing is shared and they never see the
-- owner's own TC workspace. Safe to run more than once. Run after add-brokerage-oversight.sql.
create table if not exists public.brokerage_admins (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  invited_email  text not null,
  admin_user_id  uuid,
  role           text not null check (role in ('viewer', 'reviewer', 'manager')),
  status         text not null default 'active' check (status in ('active', 'removed')),
  created_at     timestamptz not null default now(),
  removed_at     timestamptz
);
create unique index if not exists uq_brokerage_admins_email on public.brokerage_admins (owner_user_id, lower(invited_email)) where status = 'active';
create index if not exists idx_brokerage_admins_lookup on public.brokerage_admins (lower(invited_email)) where status = 'active';

alter table public.brokerage_admins enable row level security;
revoke all on table public.brokerage_admins from anon, authenticated;
grant select, insert, update, delete on table public.brokerage_admins to service_role;

notify pgrst, 'reload schema';


-- ======================================================================
-- add-brokerage-automations.sql
-- ======================================================================
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

commit;
