-- Multiple signers, in order, on one document.
-- Each signer is their own signing_requests row; rows for the same send share
-- a group_id and are ordered by signing_order. Signers after the first start
-- with awaiting_turn = true and are activated (and emailed) when the signer
-- before them finishes.
--
-- Also run add-signing-fields.sql first if you haven't (placed signature spots).

ALTER TABLE signing_requests
  ADD COLUMN IF NOT EXISTS group_id UUID,
  ADD COLUMN IF NOT EXISTS signing_order INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS awaiting_turn BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_signing_requests_group_id ON signing_requests(group_id);
