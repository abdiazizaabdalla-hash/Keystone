-- Auto-0: hourly runner schedule. Vercel Hobby only allows daily crons, so Supabase calls the app every hour instead.
-- BEFORE RUNNING: replace <APP_URL> (e.g. https://your-app.vercel.app, no trailing slash) and <CRON_SECRET> (same value as the
-- CRON_SECRET env var in Vercel). Never commit the filled-in version. Run on relay-test first (point <APP_URL> at a reachable
-- URL, or skip this file locally and call the route by hand); production only when the automation flag is going on there.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('relay-automation-tick') where exists (select 1 from cron.job where jobname = 'relay-automation-tick');

select cron.schedule(
  'relay-automation-tick',
  '7 * * * *',
  $$ select net.http_get(
       url := '<APP_URL>/api/cron/automation-tick',
       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
       timeout_milliseconds := 60000
     ); $$
);

select jobid, jobname, schedule, active from cron.job where jobname = 'relay-automation-tick';
