-- Adds a per-document "does this need a signature at all" flag, separate
-- from `is_signed` (which tracks whether a document that DOES need a
-- signature has been signed). Run this once in the Supabase SQL editor
-- (Project -> SQL Editor).
--
-- Why this is needed: not every uploaded document is something a signer
-- ever needs to sign (photos, MLS printouts, internal notes, etc). Before
-- this column existed, every document showed a "Signed" checkbox and a
-- "Request Signature" button regardless of whether that made sense.
-- Defaults to TRUE so every existing document keeps behaving exactly as
-- it does today; the TC can flip it off per document from the
-- transaction's Documents section.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS requires_signature BOOLEAN NOT NULL DEFAULT TRUE;
