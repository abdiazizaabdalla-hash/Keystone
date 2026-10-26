-- "Needs attention today": lets a coordinator dismiss an item they don't want to see
-- (a task, a listing step, a closing). Dismissed items are only hidden from that
-- person's own Needs Attention panel; the task itself is never changed or completed.
-- Safe to run more than once. Run in the Supabase SQL editor.

create table if not exists public.attention_dismissals (
  tc_user_id    uuid not null,
  item_key      text not null check (char_length(item_key) between 1 and 200),
  dismissed_at  timestamptz not null default now(),
  primary key (tc_user_id, item_key)
);

-- Only ever read or written through the server (service role), never straight from the browser.
alter table public.attention_dismissals enable row level security;
revoke all on public.attention_dismissals from anon, authenticated;
