-- Per-transaction email ingestion (Phase 2, Section 21 of the roadmap):
-- a TC can forward or CC mail about a deal to a dedicated address and
-- have it land threaded on the transaction instead of staying stuck in
-- their own inbox. See src/app/api/email/inbound/route.ts.

-- A short, globally-unique token used to build each transaction's own
-- inbound address, e.g. deal-<token>@<your inbound domain>. Deliberately
-- NOT file_number: file_number has no uniqueness constraint and is
-- chosen per-TC, so two different TCs' deals could collide on it. This
-- token is generated server-side and is unique across every TC's
-- transactions, so an inbound email can never get routed to the wrong
-- account.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS inbound_token TEXT;

-- Backfill every existing transaction with a random token before the
-- column is locked down -- collision odds across a handful of rows are
-- astronomically small (32 bits of randomness each), and the UNIQUE
-- constraint right after this would fail loudly (and safely) in the
-- rare event two ever collided.
UPDATE transactions
SET inbound_token = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
WHERE inbound_token IS NULL;

ALTER TABLE transactions ALTER COLUMN inbound_token SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_inbound_token_key'
  ) THEN
    ALTER TABLE transactions ADD CONSTRAINT transactions_inbound_token_key UNIQUE (inbound_token);
  END IF;
END $$;

-- The communication log itself -- one row per inbound email, threaded
-- to a transaction. Populated only by the webhook in
-- src/app/api/email/inbound/route.ts; nothing in the app writes here
-- any other way.
CREATE TABLE IF NOT EXISTS transaction_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  resend_email_id TEXT NOT NULL UNIQUE,
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_email TEXT NOT NULL,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transaction_emails_transaction_id_idx ON transaction_emails(transaction_id);

GRANT ALL ON transaction_emails TO anon, authenticated, service_role;

-- Tags a document as auto-filed from an ingested email rather than
-- uploaded by hand, and which email it came from, so the Documents UI
-- can show "via email" instead of implying the TC uploaded it.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_email_id UUID REFERENCES transaction_emails(id) ON DELETE SET NULL;
