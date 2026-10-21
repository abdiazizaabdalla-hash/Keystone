-- Calendar preferences: which kinds of dates a user wants on their calendar
-- (applies to both the Google Calendar sync and the subscribe link).
-- Safe to run more than once. Until this runs, everyone keeps the old behaviour (all on).

create table if not exists public.calendar_preferences (
  user_id        uuid primary key,
  critical_dates boolean not null default true,  -- inspection, appraisal, financing, earnest money, title, custom
  closing_date   boolean not null default true,  -- the closing day
  deal_tasks     boolean not null default true,  -- transaction checklist due dates (TC only)
  listing_steps  boolean not null default true,  -- listing checklist due dates (TC only)
  listing_dates  boolean not null default true,  -- go-live day, expiration, open houses, price reviews
  updated_at     timestamptz not null default now()
);

alter table public.calendar_preferences enable row level security;
revoke all on public.calendar_preferences from anon, authenticated;
grant all on public.calendar_preferences to service_role;

notify pgrst, 'reload schema';
