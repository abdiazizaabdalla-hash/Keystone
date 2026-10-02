-- "Waiting On" -- who/what a checklist task is blocked on (lender,
-- title, buyer, seller, inspector, etc.) and the date that started, so a
-- cross-transaction "Needs Attention" view can surface what's actually
-- stuck instead of just what has a due date. Fully independent of
-- due_date/due_date_spec/completed -- a task can be both overdue and
-- waiting on someone, or neither. See src/app/api/tasks/[id]/route.ts
-- (PATCH, `waitingOn` field) and the Checklist card on the transaction
-- page. waiting_on_since is stamped server-side the moment waiting_on
-- goes from empty to set, and cleared when waiting_on is cleared --
-- editing the text of an existing "waiting on X" does not reset it.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS waiting_on TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS waiting_on_since DATE;
