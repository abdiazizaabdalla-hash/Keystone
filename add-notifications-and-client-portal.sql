-- Notification bell + client progress portal.
-- Run this ONCE in the Supabase SQL Editor (Project -> SQL Editor) before
-- deploying the code that uses it. Safe to re-run (everything is
-- "if not exists" / "drop ... if exists").
--
-- 1) notifications: one row per person per event ("your agent checked off
--    Inspection", "new message", "closing date moved"). Written by the
--    server with the service-role client (src/lib/notifications.ts); the
--    bell in the TC dashboard and the agent portal reads them back through
--    GET /api/notifications. Like every other table in this schema, access
--    is enforced in application code, so anon/authenticated get no direct
--    access (see lock-down-database-access.sql).
-- 2) client portal: reuses external_access_links (the magic-link table)
--    with a new 'progress' scope, plus the per-step "client can see this"
--    flag on tasks.

-- ---------------------------------------------------------------------
-- 1) Notifications
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id     uuid references auth.users(id) on delete set null,
  transaction_id    uuid references public.transactions(id) on delete cascade,
  -- message | task_completed | date_changed | document_added | stage_changed | client_viewed
  event_type        text not null,
  title             text not null check (char_length(title) between 1 and 200),
  body              text,
  -- in-app path to open when the notification is clicked
  link              text,
  -- how many events were folded into this row (a burst of messages shows
  -- as one "3 new messages" row instead of three)
  event_count       integer not null default 1,
  read_at           timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists idx_notifications_recipient_created
  on public.notifications (recipient_user_id, created_at desc);
create index if not exists idx_notifications_recipient_unread
  on public.notifications (recipient_user_id) where read_at is null;
create index if not exists idx_notifications_transaction
  on public.notifications (transaction_id);

alter table public.notifications enable row level security;
revoke all on table public.notifications from anon, authenticated;
grant select, insert, update, delete on table public.notifications to service_role;

-- ---------------------------------------------------------------------
-- 2) Client portal ('progress' links)
-- ---------------------------------------------------------------------
alter table public.external_access_links
  drop constraint if exists external_access_links_scope_check;
alter table public.external_access_links
  add constraint external_access_links_scope_check
  check (scope in ('document', 'dates', 'progress'));

-- Shown only on a progress link's page: who it is for, and an optional
-- note from the TC ("Hi Sam -- here's where we are...").
alter table public.external_access_links add column if not exists client_name text;
alter table public.external_access_links add column if not exists client_note text;

-- Which checklist steps a client can see on their progress page. Off by
-- default, so nothing internal is ever visible until the TC picks it.
alter table public.tasks add column if not exists client_visible boolean not null default false;

-- Verify (should list the new table plus the three new columns):
select table_name, column_name from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'notifications')
    or (table_name = 'external_access_links' and column_name in ('client_name', 'client_note'))
    or (table_name = 'tasks' and column_name = 'client_visible'))
order by table_name, ordinal_position;
