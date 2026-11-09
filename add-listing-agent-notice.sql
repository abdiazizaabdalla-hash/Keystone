-- Remembers whether an agent has already seen the "your coordinator added you to a listing" banner, so it shows once.
-- Safe to run more than once. Listings already shared with agents count as seen.
alter table public.listings add column if not exists agent_notice_seen boolean not null default true;
alter table public.listings alter column agent_notice_seen set default false;

notify pgrst, 'reload schema';
