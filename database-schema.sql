-- Users table (TCs and Agents)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('TC', 'Agent')),
  password_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agents table (managed by TC)
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tc_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  brokerage VARCHAR(255),
  commission_percent DECIMAL(5,2) NOT NULL DEFAULT 25,
  email VARCHAR(255),
  phone VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table (deals)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  file_number VARCHAR(255) NOT NULL,
  property_address VARCHAR(500),
  purchase_price DECIMAL(12,2),
  status VARCHAR(100) DEFAULT 'Contract Pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tasks table (checklist items)
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Invoices table
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  amount_owed DECIMAL(12,2) NOT NULL,
  invoice_number VARCHAR(100) NOT NULL UNIQUE,
  invoice_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  due_date DATE NOT NULL,
  paid BOOLEAN DEFAULT FALSE,
  paid_at TIMESTAMP,
  paid_amount DECIMAL(12,2),
  sent_at TIMESTAMP,
  sent_to VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_agents_tc_user_id ON agents(tc_user_id);
CREATE INDEX idx_transactions_agent_id ON transactions(agent_id);
CREATE INDEX idx_tasks_transaction_id ON tasks(transaction_id);
CREATE INDEX idx_invoices_agent_id ON invoices(agent_id);
CREATE INDEX idx_invoices_paid ON invoices(paid);

-- Enable RLS (Row Level Security)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- RLS Policies for agents (TC only sees their own agents)
CREATE POLICY "TC can see their own agents"
  ON agents FOR SELECT
  USING (tc_user_id = auth.uid());

CREATE POLICY "TC can insert their own agents"
  ON agents FOR INSERT
  WITH CHECK (tc_user_id = auth.uid());

-- RLS Policies for transactions
CREATE POLICY "TC can see agent transactions"
  ON transactions FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM agents WHERE tc_user_id = auth.uid()
    )
  );

CREATE POLICY "TC can insert transactions"
  ON transactions FOR INSERT
  WITH CHECK (
    agent_id IN (
      SELECT id FROM agents WHERE tc_user_id = auth.uid()
    )
  );

-- RLS Policies for tasks
CREATE POLICY "TC can see agent tasks"
  ON tasks FOR SELECT
  USING (
    transaction_id IN (
      SELECT t.id FROM transactions t
      JOIN agents a ON t.agent_id = a.id
      WHERE a.tc_user_id = auth.uid()
    )
  );

-- RLS Policies for invoices
CREATE POLICY "TC can see agent invoices"
  ON invoices FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM agents WHERE tc_user_id = auth.uid()
    )
  );

-- ============================================================
-- Migrations applied directly via the Supabase SQL Editor (not
-- yet reflected in the CREATE TABLE statements above — this file
-- has drifted from the live schema in a few other places too, but
-- these are the columns added by recent feature work):
-- ============================================================

-- Per-agent payment overrides (agents table)
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS zelle_contact text,
  ADD COLUMN IF NOT EXISTS zelle_display_name text;

ALTER TABLE agents
  ADD CONSTRAINT agents_payment_method_check
  CHECK (payment_method IN ('default', 'zelle', 'none'));

-- Online-payments integration for agent invoices. Generic across
-- providers via the `provider` column -- currently only 'stripe_connect'
-- is live (see src/lib/stripeConnect.ts and /api/stripe/connect/*): a TC
-- connects a Stripe Standard account, and agent payments go straight to
-- it via a destination-charge Checkout Session, with Relay taking no cut.
-- api_token/dba_subdomain were specific to an earlier Helcim integration
-- (since removed -- its API was never fully documented/verified) and are
-- unused by Stripe Connect; left in place only so no historical row loses
-- data. Do not build new code against them.
CREATE TABLE IF NOT EXISTS payment_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tc_user_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT 'stripe_connect',
  connected_account_id TEXT NOT NULL,
  api_token TEXT, -- legacy Helcim field, unused -- see note above
  dba_subdomain TEXT, -- legacy Helcim field, unused -- see note above
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tc_user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_payment_accounts_connected_account_id ON payment_accounts(connected_account_id);

-- helcim_pay_url/helcim_invoice_number were the old Helcim integration's
-- persisted pay-link columns (its hosted invoice pages didn't expire, so
-- the URL was cached; Stripe Connect's Checkout Sessions expire after 24h
-- and are generated fresh each time instead -- see stripe-pay-link route).
-- Unused now; left in place so no historical invoice row loses data.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS helcim_pay_url TEXT,
  ADD COLUMN IF NOT EXISTS helcim_invoice_number TEXT;

-- Customizable transaction checklist templates (Pro/Team plan feature).
-- Every account also gets a hardcoded "baseline" template for free -- see
-- BASELINE_CHECKLIST_TEMPLATE in src/lib/checklistTemplates.ts -- which has
-- no row here; this table only holds TC-authored custom ones. `steps` is
-- an ordered JSON array of step objects (ChecklistTemplateStep: `name`
-- plus an optional `dueDays` auto-due-date offset), snapshotted onto each
-- transaction's own `tasks` rows at creation time (no FK from tasks back
-- to this table), so editing or deleting a template never touches
-- transactions that already used it. Templates created before `dueDays`
-- existed have `steps` stored as plain strings -- normalizeTemplateSteps()
-- in checklistTemplates.ts reads those back fine, just with no offset.
CREATE TABLE IF NOT EXISTS checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tc_user_id UUID NOT NULL,
  name TEXT NOT NULL,
  steps JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_templates_tc_user_id ON checklist_templates(tc_user_id);

-- Snapshot of which checklist template a transaction was created with, for
-- display only (e.g. "Checklist: Baseline (default)" on the transaction
-- page). Null on legacy rows created before this column existed -- the UI
-- treats a null the same as "Baseline (default)". Editing or deleting a
-- checklist_templates row never touches this -- it's a point-in-time copy
-- of the name, same principle as tasks snapshotting their own step names.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS checklist_template_name TEXT;

-- Starter's free-forever plan became a 30-day-or-first-paid-deal trial
-- (then $10/month) -- see src/lib/trial.ts for the actual logic. This is
-- a business-rule change, not a schema change: no new columns or tables.
-- The trial clock is computed on the fly from data that already exists:
--   - start: the Supabase Auth user's own created_at (no new "signup"
--     column needed -- it's already the source of truth elsewhere, e.g.
--     account/summary's "Member since").
--   - early end: the earliest invoices.paid_at across the user's agents'
--     invoices where paid = true (an invoice only exists once a
--     transaction hits "Closed" -- the TC clicks "Create Invoice" on
--     the transaction page at that point, see
--     dashboard/transactions/[id]/page.tsx -- so this single check
--     covers both "closed" and "actually paid").
--   - grandfathering: accounts created before TRIAL_ENFORCEMENT_START
--     (a constant in src/lib/trial.ts, not a DB flag) never have the
--     trial/paywall applied at all -- they keep the old free-forever
--     Starter behavior permanently.
-- Once someone pays for Starter post-trial, it's tracked exactly like a
-- Pro/Team subscription in the existing stripe_customers table (plan =
-- 'starter', a real stripe_subscription_id) -- no separate billing model.

-- Auto-calculated checklist due dates. `acceptance_date` (mutual
-- acceptance / contract date) and `closing_date` (target closing) are
-- both TC-entered, optional, and editable after creation. `tasks.due_date`
-- is a computed SNAPSHOT, not a live formula -- it's written once at
-- transaction-creation time and rewritten whenever either anchor date
-- changes (see computeDueDates in src/lib/dueDates.ts, called from
-- POST /api/transactions, PATCH /api/transactions/[id], and PATCH
-- /api/transactions/[id]/checklist-template). The baseline checklist's
-- due dates come from the hardcoded, name-keyed BASELINE_OFFSETS table in
-- dueDates.ts; a custom Pro/Team template can now set its own per-step
-- offset too (ChecklistTemplateStep.dueDays, days after acceptance_date --
-- see checklist_templates below), which is what `tasks.due_days_after_acceptance`
-- snapshots. A task with neither a recognized baseline name nor a
-- template-authored offset gets a null due_date, same as a transaction
-- with no acceptance_date set yet -- the TC just sets it manually.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS acceptance_date DATE,
  ADD COLUMN IF NOT EXISTS closing_date DATE;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date DATE;

-- Google Calendar integration (OAuth "connect your calendar" flow -- see
-- src/lib/googleCalendar.ts, src/lib/oauthState.ts, and the
-- /api/google-calendar/* routes). One row per TC per provider; `provider`
-- is already split out even though only 'google' exists today, so a
-- second calendar provider later doesn't need a schema change, just a new
-- value here. `refresh_token` is encrypted with the same
-- encryptSecret/decryptSecret pair in src/lib/encryption.ts already used
-- for Helcim's api_token (see HELCIM_TOKEN_ENCRYPTION_KEY) -- never
-- stored plain. `google_email` is display-only ("Connected as
-- you@gmail.com" in Settings), refreshed each time the OAuth flow is
-- (re)run.
CREATE TABLE IF NOT EXISTS calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tc_user_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT 'google',
  refresh_token TEXT NOT NULL,
  google_email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tc_user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_calendar_connections_tc_user_id ON calendar_connections(tc_user_id);

-- Which Google Calendar event (if any) a task's due_date is synced to, so
-- the sync can update/delete the same event instead of creating a
-- duplicate every time a due date changes. Null until the sync in
-- lib/googleCalendar.ts first creates an event for that task.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS google_event_id TEXT;

-- In-house e-signature requests. Deliberately NOT a third-party vendor
-- integration (DocuSign/Dropbox Sign/etc. all either gate production
-- behind a manual approval, or charge per-document even at low volume;
-- see the "e-signature" build discussion) -- this is a self-contained
-- flow built on infra already in place (PDFKit-adjacent pdf-lib for
-- stamping, Supabase storage, Resend for the signer email). `token` is
-- the ONLY auth on the public /sign/[token] page and its API route, so
-- it must stay a long random opaque string (see lib/signing.ts) -- treat
-- it like a bearer credential, never something guessable or sequential.
-- v1 scope cut: rather than letting the TC place the signature at a
-- specific spot on a specific page (which would need a PDF-coordinate-
-- picking UI), a signed document gets a new final "Signature Certificate"
-- page appended with the signature image/text, signer name/email,
-- timestamp, IP, and a SHA-256 hash of the original file -- the same
-- pattern DocuSign itself uses for its own certificate page. Revisit
-- if in-place placement is ever actually requested.
CREATE TABLE IF NOT EXISTS signing_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL,
  document_id UUID, -- the `documents` row this was requested from, if any
  requested_by UUID NOT NULL, -- TC user id who sent the request
  signer_name TEXT NOT NULL,
  signer_email TEXT NOT NULL,
  source_storage_path TEXT NOT NULL, -- unsigned PDF, in the transaction-documents bucket
  source_file_name TEXT NOT NULL,
  document_hash TEXT NOT NULL, -- SHA-256 of the unsigned PDF, captured at request time
  signed_storage_path TEXT, -- filled in once signed
  signed_document_id UUID, -- the new `documents` row created for the signed PDF, once signed
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'voided')),
  signature_type TEXT CHECK (signature_type IN ('typed', 'drawn')),
  signed_at TIMESTAMPTZ,
  signer_ip TEXT,
  signer_user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signing_requests_transaction_id ON signing_requests(transaction_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signing_requests_token ON signing_requests(token);

-- Manual "is this already signed?" designation, asked right after the TC
-- hits Upload on a document -- separate from the in-house e-signature
-- flow above, for documents that were already signed outside Relay
-- (on paper, or via an existing DocuSign account) and just need to be
-- filed as such. Also set to true on the signed PDF produced by the
-- e-signature flow itself (see api/signing-requests/public/[token]),
-- so `is_signed` alone is a reliable source of truth for the Documents
-- section's Not Signed / Signed split.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_signed BOOLEAN NOT NULL DEFAULT false;

-- Backfill: documents that are already-produced signed copies from a
-- completed signing request predate this column and would otherwise
-- read as not-signed.
UPDATE documents
SET is_signed = true
WHERE id IN (
  SELECT signed_document_id FROM signing_requests WHERE signed_document_id IS NOT NULL
)
AND is_signed = false;

-- Per-step auto-due-date offset for custom checklist templates (extends
-- the baseline-only due-date system above to Pro/Team custom templates).
-- A custom template's step can now carry its own `dueDays` (days after
-- acceptance_date) in checklist_templates.steps -- see
-- ChecklistTemplateStep in src/lib/checklistTemplates.ts. This column is
-- where that offset gets SNAPSHOTTED onto the task at creation/template-
-- switch time, same principle as `tasks.name` and `tasks.due_date`
-- already being point-in-time copies: it lets a later acceptance/closing
-- date edit (PATCH /api/transactions/[id]) recompute this task's due_date
-- from the task row alone, with no need to look the template back up (it
-- may since have been edited or deleted). Null means "no auto due date
-- for this task" -- either a baseline step (which uses BASELINE_OFFSETS
-- by name instead) or a custom step the TC left unscheduled.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_days_after_acceptance INTEGER;

-- Opt-in per-agent status-update emails: when true, PATCH /api/tasks
-- emails this agent (see lib/agentEmails.ts) whenever the TC marks a
-- checklist step complete on one of their deals. Off by default on
-- every existing and new agent row so nobody's inbox fills up with one
-- email per checkbox unless the TC deliberately turns it on for that
-- agent (Settings live on the Agents page). Requires agents.email to
-- actually be set -- the send is skipped otherwise, checked in the
-- PATCH handler, not enforced at the DB level.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS notify_on_task_complete BOOLEAN NOT NULL DEFAULT false;

-- NOTE: this per-agent task-completion email was removed from the app
-- (no UI sets it, and PATCH /api/tasks no longer sends anything on it) --
-- left in place only so no data is lost for any row that already has it
-- set. Safe to ignore/drop later.

-- Every checklist step's due date is now an explicit choice the TC makes
-- (at transaction-creation time for every step, baseline included, and
-- when building/editing a custom template) rather than a value silently
-- assumed for baseline steps by name. due_date_spec stores that choice as
-- JSON -- see DueDateSpec in src/lib/dueDates.ts, e.g.
-- {"mode":"after_acceptance","days":10} or {"mode":"fixed","fixedDate":
-- "2026-03-01"} or {"mode":"none"}. Snapshotted onto the task at creation/
-- template-switch time, same principle as due_days_after_acceptance
-- before it: a later acceptance/closing date edit recomputes due_date
-- from this column alone. due_days_after_acceptance is left in place
-- (unused by new writes) purely so older rows saved before this column
-- existed keep reading back correctly via dueDaysToSpec().
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date_spec JSONB;
-- "Waiting On" -- who/what a checklist task is blocked on (lender,
-- title, buyer, seller, inspector, etc.) and the date that started, so a
-- cross-transaction "Needs Attention" view can surface what's actually
-- stuck instead of just what has a due date. Fully independent of
-- due_date/due_date_spec/completed -- a task can be both overdue and
-- waiting on someone, or neither. See src/app/api/tasks/[id]/route.ts
-- (PATCH, `waitingOn` field) and the Checklist card on the transaction
-- page. waiting_on_since is stamped server-side the moment waiting_on
-- goes from empty to set, and cleared when waiting_on is cleared --
-- editing the text of an existing "waiting on X" does not reset it.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS waiting_on TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS waiting_on_since DATE;
