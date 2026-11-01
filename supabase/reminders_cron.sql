-- =====================================================================
-- Minutes · minute-by-minute reminders.
-- Run AFTER the app is deployed. Replace the two placeholders first:
--   YOUR-APP.vercel.app   → your Vercel domain
--   YOUR-CRON-SECRET      → the same value as CRON_SECRET in Vercel
-- Supabase calls /api/reminders every minute; it sends any reminders that are due.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('minutes-reminders')
where exists (select 1 from cron.job where jobname = 'minutes-reminders');

select cron.schedule(
  'minutes-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-APP.vercel.app/api/reminders',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer YOUR-CRON-SECRET'),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

-- Check it's running (after a few minutes):
-- select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
