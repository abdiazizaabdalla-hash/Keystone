-- Scoped external access: a magic-link, no-login view for a lender,
-- title company, or inspector to see either one document or just this
-- deal's key dates -- without a Relay TC account, and without seeing
-- anything else on the transaction. The token's own entropy is the
-- only auth, same pattern as signing_requests.token (see lib/signing.ts
-- and the public /api/signing-requests/public/[token] route) -- this
-- migration mirrors that table's shape rather than inventing a new one.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor)
-- before the external-links code in the app can work.

CREATE TABLE IF NOT EXISTS external_access_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  token TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK (scope IN ('document', 'dates')),
  document_id UUID, -- required when scope = 'document', ignored otherwise
  -- A free-text note for the TC's OWN list only ("Wells Fargo -- lender")
  -- -- never shown to whoever opens the link, never emailed anywhere.
  recipient_label TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_access_links_transaction_id ON external_access_links(transaction_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_external_access_links_token ON external_access_links(token);
