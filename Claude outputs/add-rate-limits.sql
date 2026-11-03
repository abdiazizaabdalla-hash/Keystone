-- Adds a tiny, self-contained rate limiter backed entirely by Postgres --
-- no new vendor account needed. Run this once in the Supabase SQL editor
-- (Project -> SQL Editor) before deploying the rate-limiting code changes,
-- since those routes call check_rate_limit() on every request.
--
-- Why a DB function instead of an in-memory counter: this app runs on
-- Vercel's serverless functions, which don't share memory between
-- invocations (or even between two requests hitting the "same" function
-- seconds apart). An in-memory counter would silently reset constantly
-- and never actually limit anything. Postgres is the one piece of shared
-- state every invocation can already reach.
--
-- The UPSERT below is a single atomic statement, so two requests for the
-- same key arriving at the same instant can't both read count=0 and both
-- proceed (the race that breaks naive read-then-write rate limiters).

create table if not exists rate_limits (
  key text primary key,
  count integer not null default 1,
  window_start timestamptz not null default now()
);

-- p_key: caller-chosen bucket, e.g. 'signin:ip:1.2.3.4' or 'signin:email:x@y.com'.
-- p_max: how many hits are allowed inside the window before this returns false.
-- p_window_seconds: length of the sliding-ish (fixed, reset-on-expiry) window.
create or replace function check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
as $$
declare
  v_count integer;
  v_window_start timestamptz;
begin
  insert into rate_limits (key, count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
    set count = case
          when rate_limits.window_start < now() - (p_window_seconds || ' seconds')::interval
            then 1
          else rate_limits.count + 1
        end,
        window_start = case
          when rate_limits.window_start < now() - (p_window_seconds || ' seconds')::interval
            then now()
          else rate_limits.window_start
        end
  returning count, window_start into v_count, v_window_start;

  return v_count <= p_max;
end;
$$;

-- Old rows are cheap to keep (one row per key) but harmless to prune.
-- Not required for correctness, just housekeeping if this table ever
-- gets large -- safe to run manually now and again, no cron required for
-- launch.
-- delete from rate_limits where window_start < now() - interval '1 day';
