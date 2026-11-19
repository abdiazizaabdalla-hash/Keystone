-- Team reports: scheduled activity reports for a team owner, saved in Relay so each week or month can be downloaded again.
-- Safe to re-run. Run in the Supabase SQL editor.
--  * tasks.completed_at: when a checklist step was ticked, so a report can say which steps were completed in its period.
--  * team_report_settings: how often to generate (off / weekly / monthly) and the notes to put in every report's Notes tab.
--  * team_reports: one row per generated report (a snapshot of the data plus that report's own notes).
alter table public.tasks add column if not exists completed_at timestamptz;

create table if not exists public.team_report_settings (
  owner_user_id uuid primary key,
  team_id       uuid references public.teams(id) on delete cascade,
  cadence       text not null default 'off' check (cadence in ('off', 'weekly', 'monthly')),
  notes         text check (notes is null or char_length(notes) <= 5000),
  updated_at    timestamptz not null default now()
);

create table if not exists public.team_reports (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  team_id       uuid references public.teams(id) on delete cascade,
  cadence       text not null default 'manual' check (cadence in ('manual', 'weekly', 'monthly')),
  period_start  date not null,
  period_end    date not null,
  generated_at  timestamptz not null default now(),
  notes         text check (notes is null or char_length(notes) <= 5000),
  data          jsonb not null default '{}'::jsonb
);
create index if not exists idx_team_reports_owner on public.team_reports (owner_user_id, period_end desc);
-- One scheduled report per owner, cadence and period (the daily job can run again without making a second one).
create unique index if not exists team_reports_scheduled_uniq on public.team_reports (owner_user_id, cadence, period_start) where cadence <> 'manual';

alter table public.team_report_settings enable row level security;
alter table public.team_reports enable row level security;
revoke all on table public.team_report_settings from anon, authenticated;
revoke all on table public.team_reports from anon, authenticated;
grant select, insert, update, delete on table public.team_report_settings to service_role;
grant select, insert, update, delete on table public.team_reports to service_role;
