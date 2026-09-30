-- Backs src/lib/rateLimit.ts's checkRateLimit(). Atomic fixed-window
-- counter: each call is a single INSERT ... ON CONFLICT, so concurrent
-- Vercel serverless invocations can't race each other into both reading
-- "under the limit" before either writes back (the classic bug with a
-- naive read-then-write counter). State lives here in Postgres rather
-- than in any one function instance's memory, which doesn't persist
-- or share across invocations anyway.

create table if not exists rate_limits (
  key text primary key,
  count integer not null default 1,
  window_start timestamptz not null default now()
);

alter table rate_limits enable row level security;
-- No policies added on purpose: this table is only ever touched via the
-- service-role client (supabaseServer), which bypasses RLS entirely.
-- Enabling it with zero policies just makes sure it's never reachable
-- through the anon/authenticated PostgREST roles either.

create or replace function check_rate_limit(
  p_key text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
as $$
declare
  v_count integer;
  v_window_start timestamptz;
begin
  insert into rate_limits (key, count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
    set
      count = case
        when rate_limits.window_start <= now() - (p_window_seconds || ' seconds')::interval
          then 1
        else rate_limits.count + 1
      end,
      window_start = case
        when rate_limits.window_start <= now() - (p_window_seconds || ' seconds')::interval
          then now()
        else rate_limits.window_start
      end
  returning count, window_start into v_count, v_window_start;

  return v_count <= p_max;
end;
$$;
