-- Remembers which Google Calendar event holds each deal's closing day, per person (TC and each agent),
-- so moving the closing date updates the same event instead of creating a duplicate.
-- Safe to run more than once.
create table if not exists public.transaction_closing_events (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references public.transactions(id) on delete cascade,
  user_id         uuid not null,
  google_event_id text not null,
  created_at      timestamptz not null default now(),
  unique (transaction_id, user_id)
);
create index if not exists idx_tce_user on public.transaction_closing_events (user_id);

alter table public.transaction_closing_events enable row level security;
revoke all on public.transaction_closing_events from anon, authenticated;
grant all on public.transaction_closing_events to service_role;

notify pgrst, 'reload schema';
