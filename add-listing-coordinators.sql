-- An agent with a workspace can invite a transaction coordinator onto one of their own listings (the listing equivalent of
-- a deal's coordinator invite). The listing stays the agent's; once the coordinator accepts it appears in their Listings list
-- and they work it with the agent. Safe to re-run.
create table if not exists public.listing_coordinators (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  email text not null,
  invited_by uuid not null,
  coordinator_user_id uuid,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index if not exists listing_coordinators_listing_email_uniq on public.listing_coordinators (listing_id, lower(email));
create index if not exists idx_listing_coordinators_user on public.listing_coordinators (coordinator_user_id) where coordinator_user_id is not null;
create index if not exists idx_listing_coordinators_email on public.listing_coordinators (lower(email));
alter table public.listing_coordinators enable row level security;
