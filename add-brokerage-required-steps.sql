-- Brokerage required steps: a checklist the broker sets once, for transactions and for listings, that is added to every agent's files.
-- New files get the missing steps when they are created; "Add to files already open" does the same for open files. A step an agent
-- already has (same name) is never added twice. Safe to run more than once. Run after add-brokerage-oversight.sql.
create table if not exists public.brokerage_required_steps (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  kind           text not null check (kind in ('transaction', 'listing')),
  name           text not null check (char_length(name) between 1 and 60),
  -- Days after acceptance (a transaction) or after the planned list date (a listing). Empty means no due date.
  due_days       int check (due_days is null or due_days between 0 and 365),
  position       int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_brokerage_required_steps_owner on public.brokerage_required_steps (owner_user_id, kind, position);
alter table public.brokerage_required_steps enable row level security;
revoke all on table public.brokerage_required_steps from anon, authenticated;
grant select, insert, update, delete on table public.brokerage_required_steps to service_role;
notify pgrst, 'reload schema';
