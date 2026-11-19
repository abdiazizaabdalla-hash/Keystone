-- Per-agent permission on a brokerage link: may the brokerage owner open this agent's document files (contracts, disclosures,
-- uploads), or only see the document names? The agent controls it from their Brokerage page and sees it before accepting.
-- Default is on, which is how the owner's deal and listing pages already work; an agent can switch it off any time.
-- Safe to re-run. Run after add-brokerage-oversight.sql.
alter table public.brokerage_links add column if not exists can_open_documents boolean not null default true;
