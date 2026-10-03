-- Reverts part of add-brokerage-org.sql: the org-level fee/invoicing
-- defaults were the wrong mental model for Brokerage. A brokerage pays
-- Relay to run its OWN transaction operation -- it isn't in the business
-- of charging its in-house agents a coordination fee the way an
-- independent TC charges outside agents it works with deal-by-deal.
-- There is no "default flat fee" or "invoice due in N days" to set at
-- the org level, because there's no invoice to the brokerage's own
-- agents in the first place.
--
-- default_checklist_template_id is kept -- standardizing the checklist/
-- workflow across a brokerage's TCs is a real, fee-unrelated default,
-- used once checklist_templates.team_id (also added in add-brokerage-
-- org.sql) actually has UI built on top of it.

ALTER TABLE teams DROP COLUMN IF EXISTS default_flat_fee;
ALTER TABLE teams DROP COLUMN IF EXISTS default_percent_fee;
ALTER TABLE teams DROP COLUMN IF EXISTS default_invoice_due_days;
