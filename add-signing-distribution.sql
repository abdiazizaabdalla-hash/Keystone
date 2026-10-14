-- "Email a signed copy to others" -- when a TC sends a document for
-- signature they can list extra recipients (lender, title company, the
-- agent, a co-op agent...) and an email message. Once the signer signs, the
-- signed PDF is emailed to each of them automatically.
-- Run this once in the Supabase SQL editor BEFORE deploying the code that
-- uses it. Nothing here changes existing rows.

ALTER TABLE signing_requests
  ADD COLUMN IF NOT EXISTS distribute_to JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS distribute_subject TEXT,
  ADD COLUMN IF NOT EXISTS distribute_message TEXT,
  ADD COLUMN IF NOT EXISTS distributed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS distribution_error TEXT;
