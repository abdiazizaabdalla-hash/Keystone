-- Archive: a listing that did not go anywhere (seller changed their mind, expired, duplicate...) leaves everyday work
-- without being deleted. It keeps its checklist, offers and documents, and can be restored to the status it had.
-- Safe to run more than once. Nothing changes for any existing listing.
alter table public.listings add column if not exists archived_at         timestamptz;
alter table public.listings add column if not exists archive_reason      text;
alter table public.listings add column if not exists archive_note        text;
alter table public.listings add column if not exists archived_by         uuid;
alter table public.listings add column if not exists archive_prev_status text;

create index if not exists idx_listings_archived on public.listings (tc_user_id) where archived_at is not null;

notify pgrst, 'reload schema';
