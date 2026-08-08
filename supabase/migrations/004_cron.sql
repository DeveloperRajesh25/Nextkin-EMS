-- ============================================================================
-- NextKinLife EMS — 004_cron.sql
-- Schedules for the visa reminder engine and the Google Calendar incremental
-- sync fallback, run from inside Postgres with pg_cron + pg_net.
--
-- THIS FILE IS OPTIONAL. Pick ONE scheduler:
--   (a) pg_cron (this file) — nothing outside Supabase to configure.
--   (b) cron-job.org / Vercel Cron — see SETUP.md §10. Recommended if you want
--       an external scheduler that sees the HTTP status and alerts on failure.
-- Running both just double-fires the jobs; that is harmless (the visa engine is
-- idempotent via UNIQUE(work_auth_id, milestone)) but wasteful.
--
-- THE RELIABILITY RULE (§8)
-- -------------------------
-- pg_net is fire-and-forget: `net.http_post` returns a request id immediately
-- and a 500 from the app lands quietly in `net._http_response`. A job that never
-- works still shows as "succeeded" in cron.job_run_details. That is exactly the
-- silently-green failure mode this codebase exists to avoid, so
-- `cron.monitor-http` below reads the responses back, records every non-2xx in
-- public.cron_runs (surfaced in the super-admin console) and RAISEs a WARNING
-- into the Postgres logs.
-- ============================================================================

create extension if not exists pg_cron  with schema pg_catalog;
create extension if not exists pg_net   with schema extensions;

-- ---------------------------------------------------------------------------
-- Configuration lives in Supabase Vault, never in this file.
--
-- Run these TWO statements once, with your real values, before scheduling:
--
--   select vault.create_secret('https://ems.yourdomain.com', 'ems_app_url',
--                              'NextKinLife EMS base URL (no trailing slash)');
--   select vault.create_secret('<the same value as CRON_SECRET in Vercel>',
--                              'ems_cron_secret', 'x-cron-secret header value');
--
-- To rotate later:  select vault.update_secret(id, '<new value>') ...
-- ---------------------------------------------------------------------------

create or replace function public.cron_secret_value(p_name text)
returns text
language sql
stable
security definer
set search_path = vault, public, pg_temp
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;

revoke execute on function public.cron_secret_value(text) from anon, authenticated, public;

/**
 * POST to an authenticated cron endpoint with the constant-time-compared
 * `x-cron-secret` header. Returns the pg_net request id so the monitor below can
 * match the response back to the job.
 */
create or replace function public.cron_call(p_job text, p_path text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_base   text := public.cron_secret_value('ems_app_url');
  v_secret text := public.cron_secret_value('ems_cron_secret');
  v_req    bigint;
begin
  if v_base is null or v_secret is null then
    insert into public.cron_runs (job, ok, detail)
    values (p_job, false, jsonb_build_object(
      'error', 'Vault secrets ems_app_url / ems_cron_secret are not set — job skipped'));
    raise warning '[cron] % skipped: vault secrets missing', p_job;
    return null;
  end if;

  select net.http_post(
           url     := rtrim(v_base, '/') || p_path,
           headers := jsonb_build_object(
                        'Content-Type',  'application/json',
                        'x-cron-secret', v_secret,
                        'x-cron-job',    p_job
                      ),
           body    := jsonb_build_object('source', 'pg_cron', 'job', p_job),
           timeout_milliseconds := 55000
         )
    into v_req;

  insert into public.cron_runs (job, ok, detail)
  values (p_job, true, jsonb_build_object('dispatched', true, 'request_id', v_req));

  return v_req;
end;
$$;

revoke execute on function public.cron_call(text, text) from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- The jobs
-- ---------------------------------------------------------------------------

-- Unschedule first so this file is safe to re-run.
do $$
declare j text;
begin
  foreach j in array array['ems-visa-reminders', 'ems-calendar-sync', 'ems-cron-monitor'] loop
    begin
      perform cron.unschedule(j);
    exception when others then null;
    end;
  end loop;
end $$;

-- Visa reminders: once a day at 03:30 UTC (09:00 IST — inside the working day
-- for the default Asia/Kolkata tenant, so an org sees the alert the same
-- morning). The endpoint recomputes the day-diff in EACH tenant's timezone.
select cron.schedule(
  'ems-visa-reminders',
  '30 3 * * *',
  $cron$ select public.cron_call('visa-reminders', '/api/cron/visa-reminders'); $cron$
);

-- Calendar fallback: every 15 minutes. Google push channels expire (and get
-- missed during deploys), so this incremental sync_token pass is what keeps the
-- two sides consistent when a webhook never arrives.
select cron.schedule(
  'ems-calendar-sync',
  '*/15 * * * *',
  $cron$ select public.cron_call('calendar-sync', '/api/cron/calendar-sync'); $cron$
);

-- ---------------------------------------------------------------------------
-- The monitor — turns pg_net's silence into a loud, queryable failure.
-- ---------------------------------------------------------------------------
create or replace function public.cron_check_http_results()
returns void
language plpgsql
security definer
set search_path = public, net, extensions, pg_temp
as $$
declare
  r record;
  v_failures integer := 0;
begin
  for r in
    select resp.id, resp.status_code, resp.error_msg, resp.created
      from net._http_response resp
     where resp.created > now() - interval '20 minutes'
       and (resp.status_code is null or resp.status_code < 200 or resp.status_code >= 300)
  loop
    v_failures := v_failures + 1;
    insert into public.cron_runs (job, ok, detail)
    values ('http-monitor', false, jsonb_build_object(
      'request_id',  r.id,
      'status_code', r.status_code,
      'error',       r.error_msg,
      'at',          r.created
    ));
    raise warning '[cron] HTTP call % failed: status=% error=%',
      r.id, coalesce(r.status_code::text, 'none'), coalesce(r.error_msg, 'n/a');
  end loop;

  if v_failures = 0 then
    insert into public.cron_runs (job, ok, detail)
    values ('http-monitor', true, jsonb_build_object('failures', 0));
  end if;
end;
$$;

revoke execute on function public.cron_check_http_results() from anon, authenticated, public;

select cron.schedule(
  'ems-cron-monitor',
  '*/15 * * * *',
  $cron$ select public.cron_check_http_results(); $cron$
);

-- Keep the ledger from growing forever (the super-admin console only ever looks
-- back a few weeks).
create or replace function public.cron_runs_gc()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.cron_runs where created_at < now() - interval '60 days';
$$;

revoke execute on function public.cron_runs_gc() from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- Verify:
--   select jobid, jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select * from public.cron_runs order by created_at desc limit 50;
-- ---------------------------------------------------------------------------
