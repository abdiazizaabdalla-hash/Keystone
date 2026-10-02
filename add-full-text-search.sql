-- Full-text search across a TC's transactions: communication (messages),
-- documents, checklist tasks, and the transactions themselves (address /
-- file number) -- one search box instead of opening each transaction to
-- look. Pure Postgres full-text search via generated tsvector columns +
-- GIN indexes -- no new vendor, no extra moving parts. See
-- src/app/api/search/route.ts for how these are queried.
--
-- Each column is STORED and GENERATED ALWAYS, so it updates itself on
-- every insert/update to the source columns -- nothing in the app code
-- has to remember to keep it in sync.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(body, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_messages_search ON messages USING GIN (search_vector);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(file_name, '') || ' ' || coalesce(document_type, '') || ' ' || coalesce(category, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_documents_search ON documents USING GIN (search_vector);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(waiting_on, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_tasks_search ON tasks USING GIN (search_vector);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(file_number, '') || ' ' || coalesce(property_address, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_transactions_search ON transactions USING GIN (search_vector);
