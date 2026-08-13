-- ============================================================================
-- NextKinLife EMS — 004_cron.sql
-- Removes the in-database (pg_cron) scheduling that earlier revisions of this
-- file installed.
--
-- THERE IS NOW EXACTLY ONE SCHEDULER: cron-job.org (SETUP.md §10). It calls the
-- HTTP endpoints with the `x-cron-secret` header, sees the response status, and
-- alerts on failure — which pg_net cannot do, because `net.http_post` is
-- fire-and-forget: a 500 from the app lands quietly in `net._http_response`
-- while cron.job_run_details still shows "succeeded". A silently-green job is
-- the failure mode this codebase exists to avoid.
--
-- Safe to run on a fresh database (nothing to remove) and safe to re-run.
-- `public.cron_runs` is NOT touched — it is the run ledger behind /super/system
-- and is written by the HTTP endpoints themselves.
-- ============================================================================

do $$
declare
  j text;
begin
  -- pg_cron may never have been installed; that is the normal case now.
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[004] pg_cron is not installed — nothing to unschedule';
    return;
  end if;

  foreach j in array array['ems-visa-reminders', 'ems-calendar-sync', 'ems-cron-monitor'] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
      raise notice '[004] unscheduled %', j;
    end if;
  end loop;
end $$;

-- The helper functions the schedules called. Dropping them makes it impossible
-- for a leftover schedule in another database to keep firing.
drop function if exists public.cron_check_http_results();
drop function if exists public.cron_call(text, text);
drop function if exists public.cron_secret_value(text);

-- `public.cron_runs_gc()` is deliberately kept: it prunes the ledger and was
-- never tied to a schedule. Call it by hand when the table gets large:
--   select public.cron_runs_gc();
create or replace function public.cron_runs_gc()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.cron_runs where created_at < now() - interval '60 days';
$$;

revoke execute on function public.cron_runs_gc() from anon, authenticated, public;

-- The Vault secrets `ems_app_url` / `ems_cron_secret` are left in place — they
-- hold no other role here, but deleting secrets is not something a migration
-- should do behind your back. Remove them by hand if you want:
--   select vault.delete_secret(id) from vault.secrets
--    where name in ('ems_app_url', 'ems_cron_secret');

-- Verify:
--   select jobid, jobname, schedule from cron.job;   -- expect no ems-* rows
--   select * from public.cron_runs order by created_at desc limit 20;
