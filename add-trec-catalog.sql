-- Texas: a catalog of TREC's official forms (name, form number, effective date and a link to TREC's own page for each).
-- Relay stores no copy of any TREC form; it keeps this list so it can link to TREC and notice when a form is revised.
-- Also: pins (a person's pinned folders, templates and TREC forms). Safe to re-run.
create table if not exists public.trec_forms (
  slug             text primary key,
  name             text not null,
  form_id          text not null,
  section          text not null check (section in ('contracts', 'addenda', 'other')),
  effective_date   date,
  previous_form_id text,
  changed_at       timestamptz,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  removed          boolean not null default false
);
create table if not exists public.trec_catalog_status (
  id              integer primary key default 1 check (id = 1),
  last_checked_at timestamptz,
  last_ok_at      timestamptz,
  last_error      text
);
create table if not exists public.template_pins (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  kind          text not null check (kind in ('folder', 'template', 'trec')),
  ref           text not null,
  created_at    timestamptz not null default now(),
  unique (owner_user_id, kind, ref)
);
create index if not exists idx_template_pins_owner on public.template_pins (owner_user_id);

alter table public.trec_forms enable row level security;
alter table public.trec_catalog_status enable row level security;
alter table public.template_pins enable row level security;
revoke all on table public.trec_forms from anon, authenticated;
revoke all on table public.trec_catalog_status from anon, authenticated;
revoke all on table public.template_pins from anon, authenticated;
grant select, insert, update, delete on table public.trec_forms to service_role;
grant select, insert, update, delete on table public.trec_catalog_status to service_role;
grant select, insert, update, delete on table public.template_pins to service_role;
