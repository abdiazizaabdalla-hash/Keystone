-- Brokerage administrators: people the brokerage owner lets help run the brokerage, each with a role that limits what they can do.
-- Brokerage Basic: one extra administrator with the Manager role. Brokerage Pro: up to five, any role.
-- An administrator signs in with their own Relay login (the email the owner entered); nothing is shared and they never see the
-- owner's own TC workspace. Safe to run more than once. Run after add-brokerage-oversight.sql.
create table if not exists public.brokerage_admins (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  invited_email  text not null,
  admin_user_id  uuid,
  role           text not null check (role in ('viewer', 'reviewer', 'manager')),
  status         text not null default 'active' check (status in ('active', 'removed')),
  created_at     timestamptz not null default now(),
  removed_at     timestamptz
);
create unique index if not exists uq_brokerage_admins_email on public.brokerage_admins (owner_user_id, lower(invited_email)) where status = 'active';
create index if not exists idx_brokerage_admins_lookup on public.brokerage_admins (lower(invited_email)) where status = 'active';

alter table public.brokerage_admins enable row level security;
revoke all on table public.brokerage_admins from anon, authenticated;
grant select, insert, update, delete on table public.brokerage_admins to service_role;

notify pgrst, 'reload schema';
