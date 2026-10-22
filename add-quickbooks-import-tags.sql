-- Tags agents and deals that came from a QuickBooks import so they can be separated, labelled and searched.
-- Safe to run more than once.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source TEXT;

-- Existing imports: the closed "Imported from QuickBooks" deals (no checklist, named after the invoice number)...
UPDATE transactions
SET source = 'quickbooks'
WHERE source IS NULL
  AND status = 'Closed'
  AND (file_number LIKE 'QB-%' OR file_number LIKE 'RELAY-%')
  AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.transaction_id = transactions.id);

-- ...and agents whose only deals are those.
UPDATE agents a
SET source = 'quickbooks'
WHERE a.source IS NULL
  AND EXISTS (SELECT 1 FROM transactions t WHERE t.agent_id = a.id AND t.source = 'quickbooks')
  AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.agent_id = a.id AND t.source IS DISTINCT FROM 'quickbooks');

NOTIFY pgrst, 'reload schema';
