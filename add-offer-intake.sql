-- Offers from PDFs: the original documents, plus a version history (original offer, counteroffers,
-- amendments) so every change to the terms can be seen and stepped back through.
-- Safe to run more than once. Run in the Supabase SQL editor (after add-listing-extras.sql).

-- More terms on an offer (all optional).
alter table public.listing_offers add column if not exists offer_expires_at text check (offer_expires_at is null or char_length(offer_expires_at) <= 80);
alter table public.listing_offers add column if not exists possession text check (possession is null or char_length(possession) <= 300);
alter table public.listing_offers add column if not exists contingencies text check (contingencies is null or char_length(contingencies) <= 2000);
alter table public.listing_offers add column if not exists current_version integer not null default 1;

-- One row per version of an offer's terms. `terms` is a snapshot of every term at that point.
create table if not exists public.listing_offer_versions (
  id                 uuid primary key default gen_random_uuid(),
  offer_id           uuid not null references public.listing_offers(id) on delete cascade,
  listing_id         uuid not null references public.listings(id) on delete cascade,
  version_number     integer not null,
  -- original | amendment | counteroffer | revised_offer
  kind               text not null default 'original',
  label              text check (label is null or char_length(label) <= 120),
  terms              jsonb not null default '{}'::jsonb,
  summary            text check (summary is null or char_length(summary) <= 1000),
  created_by_label   text,
  created_at         timestamptz not null default now(),
  unique (offer_id, version_number)
);
create index if not exists idx_listing_offer_versions_offer on public.listing_offer_versions (offer_id, version_number);

-- The documents behind an offer (purchase contract, addenda, counteroffers...), each tied to the version it belongs to.
create table if not exists public.listing_offer_documents (
  id            uuid primary key default gen_random_uuid(),
  offer_id      uuid not null references public.listing_offers(id) on delete cascade,
  listing_id    uuid not null references public.listings(id) on delete cascade,
  version_id    uuid references public.listing_offer_versions(id) on delete set null,
  file_name     text not null check (char_length(file_name) between 1 and 300),
  storage_path  text not null,
  content_type  text,
  file_size     bigint,
  -- purchase_contract | addendum | counteroffer | other
  doc_kind      text not null default 'other',
  received_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_listing_offer_documents_offer on public.listing_offer_documents (offer_id);

alter table public.listing_offer_versions   enable row level security;
alter table public.listing_offer_documents  enable row level security;
revoke all on table public.listing_offer_versions, public.listing_offer_documents from anon, authenticated;
grant select, insert, update, delete on table public.listing_offer_versions, public.listing_offer_documents to service_role;

NOTIFY pgrst, 'reload schema';
