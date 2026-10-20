-- E-signature for listing documents (same signing flow as deals).
-- Safe to run more than once.
--
-- A signing request now belongs to a deal OR a listing. Existing requests are untouched.

alter table public.signing_requests alter column transaction_id drop not null;

alter table public.signing_requests add column if not exists listing_id uuid references public.listings(id) on delete cascade;
alter table public.signing_requests add column if not exists listing_document_id uuid;
alter table public.signing_requests add column if not exists signed_listing_document_id uuid;
create index if not exists idx_signing_requests_listing_id on public.signing_requests (listing_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'signing_requests_target_chk') then
    alter table public.signing_requests
      add constraint signing_requests_target_chk check (transaction_id is not null or listing_id is not null);
  end if;
end $$;

-- Marks the signed copy that signing produces, and any file already signed outside Relay.
alter table public.listing_documents add column if not exists is_signed boolean not null default false;

notify pgrst, 'reload schema';
