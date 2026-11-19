-- Auto-0 follow-up: lets an action belong to the account instead of one deal (the daily briefing goes to the owner, not to a
-- deal). Run after add-automation-foundation.sql. Safe to run more than once. Run on relay-test first.
alter table public.automation_actions drop constraint if exists automation_actions_check;

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.automation_actions'::regclass and contype = 'c'
order by conname;
