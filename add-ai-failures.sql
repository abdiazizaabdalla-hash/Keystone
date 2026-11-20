-- AI read failures: one row each time an AI document read (contract, listing agreement, offer package) did not work for someone,
-- so the Admin panel can show what failed and for whom (an unreadable file, a document that is not a contract, a file that was too
-- large, an upload or service error). Only the reason, the file name and size, and a short technical note are stored; never the
-- contents of the document.
--
-- Written only by the server (service-role key); anon and authenticated get no access, same as every other table.
-- Run once in the Supabase SQL Editor.

create table if not exists public.ai_read_failures (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null,
  feature     text not null,            -- 'contract' | 'listing_agreement' | 'offer' | 'listing_contract'
  reason      text not null,            -- 'unreadable' | 'not_a_document' | 'too_large' | 'wrong_type' | 'upload_error' | 'service_error' | 'not_configured' | 'rate_limited'
  detail      text,                     -- short technical note (error message), trimmed
  file_name   text,
  file_bytes  bigint,
  resolved_at timestamptz               -- set from the Admin panel once you have looked at it
);

create index if not exists idx_ai_read_failures_created on public.ai_read_failures (created_at desc);
create index if not exists idx_ai_read_failures_user on public.ai_read_failures (user_id, created_at desc);

alter table public.ai_read_failures enable row level security;
revoke all on table public.ai_read_failures from anon, authenticated;
grant select, insert, update on table public.ai_read_failures to service_role;

notify pgrst, 'reload schema';

-- Verify (should list no anon/authenticated grants):
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'ai_read_failures' order by grantee, privilege_type;
