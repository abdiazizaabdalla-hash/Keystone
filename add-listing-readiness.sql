-- "Ready to list" card: remembers which required documents a listing does not need
-- (for example a new-construction home with no seller disclosure).
-- Safe to run more than once.

alter table public.listings add column if not exists docs_not_needed text[] not null default '{}';

notify pgrst, 'reload schema';
