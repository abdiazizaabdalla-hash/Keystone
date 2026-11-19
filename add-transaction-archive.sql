-- Archive: a transaction that did not close (fell through, cancelled, duplicate...) leaves everyday work without being deleted.
-- It is a separate flag from the stage, so the checklist-driven stage can never overwrite it, and it can be undone.
-- Safe to run more than once. Nothing changes for any existing deal.
alter table public.transactions add column if not exists archived_at    timestamptz;
alter table public.transactions add column if not exists archive_reason text;
alter table public.transactions add column if not exists archive_note   text;
alter table public.transactions add column if not exists archived_by    uuid;

create index if not exists idx_transactions_archived on public.transactions (tc_user_id) where archived_at is not null;

notify pgrst, 'reload schema';
