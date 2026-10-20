-- Listings, round 3: days on market, agent notifications, offer-email inbox, several checklist templates,
-- and a comment thread between the TC and the listing agent.
-- Safe to run more than once. Run in the Supabase SQL editor (after add-offer-intake.sql).

-- Days on market starts the first time a listing goes Active.
alter table public.listings add column if not exists listed_on date;
update public.listings set listed_on = coalesce(planned_list_date, created_at::date)
  where listed_on is null and status in ('active', 'under_offer', 'converted');

-- Optional: email the listing agent (a link only, no offer details) when an offer or showing is logged.
alter table public.listings add column if not exists notify_agent boolean not null default false;

-- A private address per listing for forwarding offer emails: listing-<token>@your inbound domain.
-- Long and random on purpose; anyone holding the address can only add a DRAFT for the TC to review.
alter table public.listings add column if not exists inbound_token text;
update public.listings
  set inbound_token = replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
  where inbound_token is null;
alter table public.listings
  alter column inbound_token set default (replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
create unique index if not exists idx_listings_inbound_token on public.listings (inbound_token);

-- More than one checklist template per TC ("Standard", "Condo", "New build"...).
alter table public.listing_template_steps add column if not exists template_name text not null default 'Standard';
create index if not exists idx_listing_template_steps_name on public.listing_template_steps (tc_user_id, template_name);

-- Offer emails waiting for review. Nothing becomes an offer until the TC confirms it.
create table if not exists public.listing_inbound_offers (
  id               uuid primary key default gen_random_uuid(),
  listing_id       uuid not null references public.listings(id) on delete cascade,
  resend_email_id  text unique,
  from_email       text,
  from_name        text,
  subject          text check (subject is null or char_length(subject) <= 300),
  snippet          text check (snippet is null or char_length(snippet) <= 600),
  -- [{ "name": "...", "path": "...", "size": 123 }]
  attachments      jsonb not null default '[]'::jsonb,
  -- pending | imported | dismissed
  status           text not null default 'pending',
  received_at      timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists idx_listing_inbound_offers_listing on public.listing_inbound_offers (listing_id, status);

-- Notes between the TC and the listing agent, shown on both sides.
create table if not exists public.listing_comments (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references public.listings(id) on delete cascade,
  author_user_id  uuid not null,
  -- tc | agent
  author_role     text not null check (author_role in ('tc', 'agent')),
  author_label    text,
  body            text not null check (char_length(body) between 1 and 2000),
  created_at      timestamptz not null default now()
);
create index if not exists idx_listing_comments_listing on public.listing_comments (listing_id, created_at);

alter table public.listing_inbound_offers enable row level security;
alter table public.listing_comments       enable row level security;
revoke all on table public.listing_inbound_offers, public.listing_comments from anon, authenticated;
grant select, insert, update, delete on table public.listing_inbound_offers, public.listing_comments to service_role;

NOTIFY pgrst, 'reload schema';
