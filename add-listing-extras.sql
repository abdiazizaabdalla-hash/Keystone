-- Listings, round 2: showings log, price history, activity history, sharing with the agent,
-- and Google Calendar event ids for listing steps/dates.
-- Safe to run more than once. Run in the Supabase SQL editor (after add-listings.sql).

-- Let the listing agent see their listing in the agent portal (on by default; the TC can turn it off per listing).
alter table public.listings add column if not exists share_with_agent boolean not null default true;
-- Google Calendar event ids (so edits move the event instead of duplicating it).
alter table public.listings      add column if not exists google_expiration_event_id text;
alter table public.listing_tasks add column if not exists google_event_id text;
alter table public.listing_dates add column if not exists google_event_id text;

-- Offer details a seller actually compares side by side.
alter table public.listing_offers add column if not exists financing text check (financing is null or char_length(financing) <= 60);
alter table public.listing_offers add column if not exists earnest_money numeric;
alter table public.listing_offers add column if not exists option_days integer;
alter table public.listing_offers add column if not exists closing_date date;
alter table public.listing_offers add column if not exists seller_concessions numeric;

-- Showings, open houses and broker tours, with the feedback that came back.
create table if not exists public.listing_showings (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(id) on delete cascade,
  showing_date date not null,
  -- showing | open_house | broker_tour
  kind         text not null default 'showing',
  visitor      text check (visitor is null or char_length(visitor) <= 200),
  -- hot | warm | cold | none  (how interested the visitor seemed)
  interest     text,
  feedback     text check (feedback is null or char_length(feedback) <= 2000),
  created_at   timestamptz not null default now()
);
create index if not exists idx_listing_showings_listing on public.listing_showings (listing_id);

-- Every list-price change, newest last.
create table if not exists public.listing_price_changes (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  old_price   numeric,
  new_price   numeric not null,
  changed_on  date not null default current_date,
  note        text check (note is null or char_length(note) <= 500),
  created_at  timestamptz not null default now()
);
create index if not exists idx_listing_price_changes_listing on public.listing_price_changes (listing_id);

-- A running history of what happened on the listing (status changes, offers, emails sent...).
create table if not exists public.listing_activity (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  actor_label text,
  summary     text not null check (char_length(summary) between 1 and 500),
  created_at  timestamptz not null default now()
);
create index if not exists idx_listing_activity_listing on public.listing_activity (listing_id, created_at desc);

alter table public.listing_showings       enable row level security;
alter table public.listing_price_changes  enable row level security;
alter table public.listing_activity       enable row level security;
revoke all on table public.listing_showings, public.listing_price_changes, public.listing_activity from anon, authenticated;
grant select, insert, update, delete on table public.listing_showings, public.listing_price_changes, public.listing_activity to service_role;

NOTIFY pgrst, 'reload schema';
