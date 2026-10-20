-- Listings: the pre-contract side of a deal. A listing has its own checklist, dates,
-- offers and contacts, and converts into a normal transaction when an offer is accepted.
-- Safe to run more than once. Run in the Supabase SQL editor.

create table if not exists public.listings (
  id                        uuid primary key default gen_random_uuid(),
  tc_user_id                uuid not null,
  agent_id                  uuid references public.agents(id) on delete set null,
  property_address          text not null check (char_length(property_address) between 1 and 300),
  seller_name               text check (seller_name is null or char_length(seller_name) <= 200),
  seller_email              text check (seller_email is null or char_length(seller_email) <= 254),
  seller_phone              text check (seller_phone is null or char_length(seller_phone) <= 40),
  list_price                numeric,
  planned_list_date         date,
  expiration_date           date,
  mls_number                text check (mls_number is null or char_length(mls_number) <= 60),
  mls_url                   text check (mls_url is null or char_length(mls_url) <= 500),
  -- preparing | active | under_offer | converted | expired | withdrawn
  status                    text not null default 'preparing',
  notes                     text check (notes is null or char_length(notes) <= 4000),
  converted_transaction_id  uuid references public.transactions(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists idx_listings_tc on public.listings (tc_user_id);
create index if not exists idx_listings_agent on public.listings (agent_id);

-- offset_days is relative to the planned list date (negative = before going live).
create table if not exists public.listing_tasks (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 200),
  offset_days  integer,
  due_date     date,
  completed    boolean not null default false,
  completed_at timestamptz,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_listing_tasks_listing on public.listing_tasks (listing_id);

create table if not exists public.listing_offers (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  buyer_name  text check (buyer_name is null or char_length(buyer_name) <= 200),
  buyer_agent text check (buyer_agent is null or char_length(buyer_agent) <= 200),
  offer_price numeric,
  terms       text check (terms is null or char_length(terms) <= 2000),
  -- received | countered | accepted | rejected | withdrawn
  status      text not null default 'received',
  received_on date,
  created_at  timestamptz not null default now()
);
create index if not exists idx_listing_offers_listing on public.listing_offers (listing_id);

create table if not exists public.listing_contacts (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  role        text check (role is null or char_length(role) <= 60),
  name        text check (name is null or char_length(name) <= 200),
  email       text check (email is null or char_length(email) <= 254),
  phone       text check (phone is null or char_length(phone) <= 40),
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_listing_contacts_listing on public.listing_contacts (listing_id);

-- Extra dates: open houses, price reviews, broker tours...
create table if not exists public.listing_dates (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  label       text not null check (char_length(label) between 1 and 120),
  due_date    date not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_listing_dates_listing on public.listing_dates (listing_id);

-- A TC's own default listing checklist. No rows = Relay's built-in starter steps.
create table if not exists public.listing_template_steps (
  id          uuid primary key default gen_random_uuid(),
  tc_user_id  uuid not null,
  name        text not null check (char_length(name) between 1 and 200),
  offset_days integer not null default 0,
  sort_order  integer not null default 0
);
create index if not exists idx_listing_template_steps_tc on public.listing_template_steps (tc_user_id);

alter table public.listings               enable row level security;
alter table public.listing_tasks          enable row level security;
alter table public.listing_offers         enable row level security;
alter table public.listing_contacts       enable row level security;
alter table public.listing_dates          enable row level security;
alter table public.listing_template_steps enable row level security;

revoke all on table public.listings, public.listing_tasks, public.listing_offers, public.listing_contacts, public.listing_dates, public.listing_template_steps from anon, authenticated;
grant select, insert, update, delete on table public.listings, public.listing_tasks, public.listing_offers, public.listing_contacts, public.listing_dates, public.listing_template_steps to service_role;

NOTIFY pgrst, 'reload schema';
