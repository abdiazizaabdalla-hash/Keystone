-- Documents and the checklist: when a document that a step was waiting for arrives, the step records it as received and
-- waits for a person to review it. Nothing is marked complete. Additive; safe to run more than once.
alter table public.tasks add column if not exists received_at timestamptz;
alter table public.tasks add column if not exists received_document_id uuid;
alter table public.tasks add column if not exists needs_review boolean not null default false;

notify pgrst, 'reload schema';
