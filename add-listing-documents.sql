-- Files on a listing (the signed listing agreement, disclosures, photos...). Stored in the same private
-- "transaction-documents" bucket under listings/<listing id>/. Safe to run more than once.
create table if not exists public.listing_documents (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.listings(id) on delete cascade,
  file_name     text not null check (char_length(file_name) between 1 and 300),
  storage_path  text not null,
  content_type  text,
  file_size     bigint,
  -- General | Listing Agreement | Seller Disclosure | Other Contract Documents
  document_type text not null default 'General',
  uploaded_by   uuid,
  created_at    timestamptz not null default now()
);
create index if not exists idx_listing_documents_listing on public.listing_documents (listing_id);

alter table public.listing_documents enable row level security;
revoke all on table public.listing_documents from anon, authenticated;
grant select, insert, update, delete on table public.listing_documents to service_role;

NOTIFY pgrst, 'reload schema';
