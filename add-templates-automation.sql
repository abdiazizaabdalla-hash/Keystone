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
