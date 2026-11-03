-- Remembers when each template was last used on a deal, so the Documents tab can show "recently used" for quick access.
-- Safe to re-run.
alter table public.doc_templates add column if not exists last_used_at timestamptz;
alter table public.doc_templates add column if not exists use_count integer not null default 0;
create index if not exists idx_doc_templates_recent on public.doc_templates (owner_user_id, last_used_at desc) where last_used_at is not null;
