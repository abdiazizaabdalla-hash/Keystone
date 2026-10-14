-- Signature spots: when a TC sends a PDF for signature they can drag
-- signature / initials / date fields onto exact spots in the document.
-- Each field is {id, type, page, x, y, w, h} with x/y/w/h as fractions of
-- the page (0-1, origin top-left). Run once in the Supabase SQL editor
-- BEFORE deploying. Nothing here changes existing rows.

ALTER TABLE signing_requests
  ADD COLUMN IF NOT EXISTS fields JSONB;
