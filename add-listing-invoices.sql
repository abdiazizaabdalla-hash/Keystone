-- Listing fees and editable invoices. Safe to re-run.
--  * agents.listing_fee: an optional default fee for listing an agent's property (set on the agent's profile).
--  * invoices can now bill a listing (kind = 'listing', listing_id) instead of a deal, so transaction_id becomes optional.
--  * invoices remember how their total was built (flat fee, percentage fee, adjustment/discount and its note) so a coordinator
--    can change the price when they create one (a promotion, say) and the PDF and screens still show the right breakdown.
alter table public.agents add column if not exists listing_fee numeric(12,2);

alter table public.invoices alter column transaction_id drop not null;
alter table public.invoices
  add column if not exists kind text not null default 'transaction',
  add column if not exists listing_id uuid,
  add column if not exists description text,
  add column if not exists flat_fee numeric(12,2),
  add column if not exists percent_fee numeric(12,2),
  add column if not exists adjustment numeric(12,2),
  add column if not exists adjustment_note text;

-- One invoice per listing and agent record.
create unique index if not exists invoices_listing_agent_uniq on public.invoices (listing_id, agent_id) where listing_id is not null;
create index if not exists idx_invoices_listing on public.invoices (listing_id) where listing_id is not null;
