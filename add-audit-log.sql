-- Audit trail: who did what, when, from where.
--
-- Written only by the server (service-role key). The anon and authenticated
-- roles get no access, same as every other table (see
-- lock-down-database-access.sql). Run once in the Supabase SQL Editor.

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  actor_id    uuid,
  actor_email text,
  action      text not null,
  entity_type text,
  entity_id   text,
  ip          text,
  user_agent  text,
  metadata    jsonb not null default '{}'::jsonb
);

create index if not exists idx_audit_log_created_at on public.audit_log (created_at desc);
create index if not exists idx_audit_log_actor on public.audit_log (actor_id, created_at desc);
create index if not exists idx_audit_log_entity on public.audit_log (entity_type, entity_id);

alter table public.audit_log enable row level security;
revoke all on table public.audit_log from anon, authenticated;
grant select, insert on table public.audit_log to service_role;

-- Verify (should list no anon/authenticated grants):
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'audit_log' order by grantee, privilege_type;
