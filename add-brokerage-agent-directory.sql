-- Corrects a conflation introduced in Phase 2: "add an agent to the
-- brokerage roster" was built by reusing the `agents` table (a TC's own
-- per-transaction invoicing/commission contact) with a shared team_id
-- flag, so any TC on the team could use that one row. That's the wrong
-- model -- it treats "this is who I bill, and at what fee, for this
-- deal" (a TC-level relationship that can legitimately differ per TC
-- per deal) as the same thing as "this person is one of our brokerage's
-- 350 agents" (an org-level identity, true regardless of who's
-- coordinating their current deal, and true even before they've ever
-- been on a transaction at all).
--
-- brokerage_agents is a pure identity/roster record: no tc_user_id, no
-- login required to exist in it. agents.brokerage_agent_id links a
-- TC's own invoicing contact for a specific deal back to the canonical
-- brokerage identity, so the brokerage's directory can aggregate "John
-- Smith has 4 transactions across 2 TCs" without forcing every TC who
-- works with John to share one row (and one fee arrangement) for him.

CREATE TABLE IF NOT EXISTS brokerage_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brokerage_agents_team_id ON brokerage_agents(team_id);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS brokerage_agent_id UUID REFERENCES brokerage_agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agents_brokerage_agent_id ON agents(brokerage_agent_id);

-- The wrong-model column from Phase 1/2 -- superseded by
-- brokerage_agent_id above.
ALTER TABLE agents DROP COLUMN IF EXISTS team_id;
