-- Fixes the "Cannot read properties of null (reading 'toLocaleString')" error on the Transactions pages.
-- Deals that the QuickBooks import saved without a deal were created with no purchase price; this sets them to 0.
-- Safe to run more than once. Only touches closed deals named after a QuickBooks/Relay invoice number.
UPDATE transactions
SET purchase_price = 0
WHERE purchase_price IS NULL
  AND status = 'Closed'
  AND (file_number LIKE 'QB-%' OR file_number LIKE 'RELAY-%');
