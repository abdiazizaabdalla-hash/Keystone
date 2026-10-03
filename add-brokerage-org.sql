-- Brokerage V1, Phase 1: decouple transaction/agent ownership from a
-- single TC so a brokerage admin can see everything, assign/reassign
-- transactions to any TC on the roster, and agents can belong to the
-- whole brokerage instead of to whichever TC happens to have added them.
--
-- Why: before this, a transaction's owner wasn't a real column -- it was
-- inherited indirectly through transactions.agent_id -> agents.tc_user_id
-- (every `agents` row, a lightweight CRM contact, belonged to exactly one
-- TC). That breaks down for a brokerage: the same real agent working with
-- two TCs would need two disconnected contact rows, and reassigning a
-- deal to a different TC wasn't a single column update.
--
-- Both new columns on transactions/agents are nullable and backfilled, so
-- Starter/Pro/Team accounts behave identically to before this migration
-- until a brokerage actually uses them.
--
-- Applied directly via the Supabase SQL Editor on 2026-10-03, same as
-- teams/team_members/team_invites before it -- saved here for the record,
-- matching this repo's other add-*.sql files.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tc_user_id UUID;

UPDATE transactions t
  SET tc_user_id = a.tc_user_id
  FROM agents a
  WHERE t.agent_id = a.id AND t.tc_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_tc_user_id ON transactions(tc_user_id);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agents_team_id ON agents(team_id);

ALTER TABLE teams ADD COLUMN IF NOT EXISTS name TEXT;

ALTER TABLE teams ADD COLUMN IF NOT EXISTS default_flat_fee NUMERIC;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS default_percent_fee NUMERIC;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS default_invoice_due_days INTEGER;

ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_checklist_templates_team_id ON checklist_templates(team_id);

ALTER TABLE teams ADD COLUMN IF NOT EXISTS default_checklist_template_id UUID REFERENCES checklist_templates(id) ON DELETE SET NULL;
