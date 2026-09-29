-- Adds refund tracking to invoices, for the Stripe Connect payment flow.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor) before
-- the "charge.refunded" webhook handler in
-- src/app/api/stripe/connect/webhook/route.ts can do anything useful.
--
-- Why this is needed: today, if an agent's payment on an invoice gets
-- refunded (the TC issues it from their own Stripe dashboard -- Relay has
-- no refund button of its own), the invoice stays marked `paid = true`
-- forever with no record the money came back. That silently overstates
-- "Revenue Collected" on both the TC's own dashboard and the admin panel.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS refunded BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS refunded_amount DECIMAL(12,2);

CREATE INDEX IF NOT EXISTS idx_invoices_refunded ON invoices(refunded);
