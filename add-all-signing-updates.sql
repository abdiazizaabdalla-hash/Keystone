-- All signing-related migrations for the latest update, in one paste.
-- Safe to run more than once. Run in the Supabase SQL editor.

-- 1) Email the signed copy to others after signing
ALTER TABLE signing_requests
  ADD COLUMN IF NOT EXISTS distribute_to JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS distribute_subject TEXT,
  ADD COLUMN IF NOT EXISTS distribute_message TEXT,
  ADD COLUMN IF NOT EXISTS distributed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS distribution_error TEXT;

-- 2) Signature / initials / date spots placed on the PDF
ALTER TABLE signing_requests
  ADD COLUMN IF NOT EXISTS fields JSONB;

-- 3) Multiple signers, in order
ALTER TABLE signing_requests
  ADD COLUMN IF NOT EXISTS group_id UUID,
  ADD COLUMN IF NOT EXISTS signing_order INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS awaiting_turn BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_signing_requests_group_id ON signing_requests(group_id);

-- 4) Make the API see the new columns right away
NOTIFY pgrst, 'reload schema';
