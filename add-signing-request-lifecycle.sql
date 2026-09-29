-- Adds the missing e-signature lifecycle states: link expiration, and a
-- 'declined' status distinct from 'voided'. Run this once in the Supabase
-- SQL editor (Project -> SQL Editor) before the void/decline/expiration
-- code in the app can work.
--
-- Why this is needed: today a signing link never expires, and there's no
-- way to tell "the TC cancelled this request" (voided) apart from "the
-- signer declined to sign" (declined) -- the 'voided' status exists in
-- the schema already but nothing ever set it, and 'declined' didn't
-- exist at all. Found during the 2026-09 e-signature reliability review.

ALTER TABLE signing_requests
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decline_reason TEXT;

-- Backfill a 14-day expiration window from each existing row's own
-- creation date, rather than from today -- an old abandoned request
-- correctly reads as already expired, instead of every pre-existing
-- request suddenly getting a fresh 14 days from whenever this migration
-- happens to run.
UPDATE signing_requests
SET expires_at = created_at + INTERVAL '14 days'
WHERE expires_at IS NULL;

ALTER TABLE signing_requests
  DROP CONSTRAINT IF EXISTS signing_requests_status_check;

ALTER TABLE signing_requests
  ADD CONSTRAINT signing_requests_status_check
  CHECK (status IN ('pending', 'signed', 'voided', 'declined'));
