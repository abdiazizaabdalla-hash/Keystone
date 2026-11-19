-- Refund tracking for invoices an agent sends from their workspace (the same idea as add-invoice-refunds.sql for coordinator invoices).
-- When a payment is refunded in the sender's Stripe dashboard, the Connect webhook records it here so totals stop counting the money.
-- Safe to re-run.
alter table public.workspace_invoices
  add column if not exists refunded boolean not null default false,
  add column if not exists refunded_at timestamptz,
  add column if not exists refunded_amount numeric(12,2);
