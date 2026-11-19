-- Local/test "outbox": when RELAY_OUTBOX_ONLY=1 the app records the emails it would have sent here instead of
-- sending them, so automation can be tried safely. Production never sets that, so nothing is ever written to this
-- table there. Safe to re-run.
create table if not exists public.email_outbox (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  transaction_id uuid,
  source         text not null default 'manual',
  to_emails      text[] not null default '{}',
  cc_emails      text[] not null default '{}',
  bcc_emails     text[] not null default '{}',
  reply_to       text,
  from_name      text,
  subject        text not null,
  body           text not null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_email_outbox_owner on public.email_outbox (owner_user_id, created_at desc);

alter table public.email_outbox enable row level security;
revoke all on table public.email_outbox from anon, authenticated;
grant select, insert, update, delete on table public.email_outbox to service_role;

select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'email_outbox'
order by grantee, privilege_type;
