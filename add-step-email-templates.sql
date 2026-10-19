-- A TC's own saved version of the email attached to a checklist step
-- (see src/lib/stepEmailTemplates.ts). Steps without a saved row fall back to
-- Relay's built-in defaults, so nothing needs seeding. Safe to re-run.
create table if not exists public.step_email_templates (
  id          uuid primary key default gen_random_uuid(),
  tc_user_id  uuid not null,
  step_key    text not null,
  subject     text not null check (char_length(subject) between 1 and 200),
  body        text not null check (char_length(body) between 1 and 6000),
  updated_at  timestamptz not null default now(),
  unique (tc_user_id, step_key)
);
create index if not exists idx_step_email_templates_user on public.step_email_templates (tc_user_id);

alter table public.step_email_templates enable row level security;
revoke all on table public.step_email_templates from anon, authenticated;
grant select, insert, update, delete on table public.step_email_templates to service_role;

select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'step_email_templates'
order by grantee, privilege_type;
