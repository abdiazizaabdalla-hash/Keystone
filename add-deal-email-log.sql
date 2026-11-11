-- One record of every email sent from a deal or listing, whichever way it was sent (the Email button on a step, a template,
-- or an automation). It is the communication history, and it is how an automatic email knows a person already sent the same
-- thing. Safe to run more than once. Nothing changes for existing data.
create table if not exists public.deal_email_log (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  transaction_id uuid references public.transactions(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete cascade,
  task_id uuid,
  source text not null,                 -- step_button | template | automation
  to_emails text[] not null default '{}',
  subject text not null,
  mode text not null default 'sent',    -- sent | outbox
  sent_at timestamptz not null default now()
);
create index if not exists idx_deal_email_log_tx on public.deal_email_log (transaction_id, sent_at desc) where transaction_id is not null;
create index if not exists idx_deal_email_log_listing on public.deal_email_log (listing_id, sent_at desc) where listing_id is not null;
create index if not exists idx_deal_email_log_task on public.deal_email_log (task_id) where task_id is not null;

alter table public.deal_email_log enable row level security;
revoke all on table public.deal_email_log from anon, authenticated;
grant select, insert, update, delete on table public.deal_email_log to service_role;

notify pgrst, 'reload schema';
