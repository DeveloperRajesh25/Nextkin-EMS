-- ============================================================================
-- NextKinLife EMS — 002_rls.sql
-- SECURITY DEFINER helpers + RLS enabled on every table + all policies.
--
-- WHY SECURITY DEFINER HELPERS (the anti-recursion rule)
-- ------------------------------------------------------
-- A policy ON profiles that sub-selects FROM profiles re-enters the same policy
-- and Postgres raises `infinite recursion detected in policy for relation
-- "profiles"`. Every membership/role/tenant question below is therefore answered
-- by a SECURITY DEFINER function, which runs as the function OWNER and so is not
-- subject to RLS — the recursion can never start. NEVER inline a sub-select
-- against a table into that table's own policy.
--
-- WHY `is_active` IS READ LIVE
-- ----------------------------
-- tenant_id / role come from the JWT claim injected by the access-token hook
-- (003) — one fewer query per policy check, and neither value changes during a
-- session. `is_active` is DELIBERATELY read from the table on every check: a JWT
-- is valid for an hour, so trusting a claim would leave a deactivated employee
-- with up to an hour of access. Deactivation must bite immediately (§3).
--
-- PERFORMANCE SHAPE
-- -----------------
-- Helpers take NO arguments so the planner folds them into a one-time InitPlan
-- per statement; the per-row work stays a plain `tenant_id = <uuid>` comparison
-- that uses the tenant_id index. Never write `app.tenant_ok(tenant_id)` — a
-- column argument forces per-row evaluation and kills the index.
-- ============================================================================

create schema if not exists app;

revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Claim readers
-- ---------------------------------------------------------------------------

/**
 * The caller's tenant. Fast path is the `tenant_id` claim minted by the
 * access-token hook; the DB fallback keeps sessions issued BEFORE the hook was
 * enabled (or during a hook outage) working instead of silently denying
 * everything.
 */
create or replace function app.current_tenant_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_tenant uuid;
begin
  begin
    v_tenant := nullif(auth.jwt() ->> 'tenant_id', '')::uuid;
  exception when others then
    v_tenant := null;
  end;

  if v_tenant is not null then
    return v_tenant;
  end if;

  select p.tenant_id into v_tenant from public.profiles p where p.id = auth.uid();
  return v_tenant;
end;
$$;

/**
 * The caller's application role: 'super_admin' | 'org' | 'employee'.
 *
 * NOTE the claim is named `user_role`, NOT `role`. `role` is reserved in a
 * Supabase JWT — PostgREST does `SET ROLE <claim.role>` on every request, so
 * overwriting it with 'org' makes every request fail with `role "org" does not
 * exist`. Custom claims must never shadow it.
 */
create or replace function app.current_user_role()
returns text
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_role text;
begin
  v_role := nullif(auth.jwt() ->> 'user_role', '');
  if v_role is not null then
    return v_role;
  end if;

  select p.role::text into v_role from public.profiles p where p.id = auth.uid();
  return v_role;
end;
$$;

/** The caller's department — backs department-targeted notification visibility. */
create or replace function app.current_department_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select p.department_id from public.profiles p where p.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Gate predicates
-- ---------------------------------------------------------------------------

/**
 * TRUE when the caller is an active profile AND (for tenant users) their tenant
 * is not suspended. Read live from the tables — this is the immediate-revocation
 * guarantee. Suspending a tenant in the super-admin console instantly locks out
 * every one of its users.
 */
create or replace function app.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
      from public.profiles p
      left join public.tenants t on t.id = p.tenant_id
     where p.id = auth.uid()
       and p.is_active
       and (p.role = 'super_admin' or (t.id is not null and t.status = 'active'))
  );
$$;

/** Platform owner. Gets a READ-ONLY cross-tenant bypass (SELECT policies only). */
create or replace function app.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select app.current_user_role() = 'super_admin' and app.is_active_member();
$$;

/** An active org (customer admin) user. Full access WITHIN its own tenant. */
create or replace function app.is_org()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select app.current_user_role() = 'org' and app.is_active_member();
$$;

/** An active employee. Restricted to its own rows. */
create or replace function app.is_employee()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select app.current_user_role() = 'employee' and app.is_active_member();
$$;

/** Is the caller assigned to this task? (Employees may move/update only these.) */
create or replace function app.is_task_assignee(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.task_assignees ta
     where ta.task_id = p_task_id and ta.profile_id = auth.uid()
  );
$$;

revoke all on all functions in schema app from anon, public;
grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS on EVERY table. No exceptions.
-- ---------------------------------------------------------------------------
alter table public.tenants              enable row level security;
alter table public.profiles             enable row level security;
alter table public.departments          enable row level security;
alter table public.attendance           enable row level security;
alter table public.leaves               enable row level security;
alter table public.payslips             enable row level security;
alter table public.invoices             enable row level security;
alter table public.notifications        enable row level security;
alter table public.notification_reads   enable row level security;
alter table public.work_authorizations  enable row level security;
alter table public.visa_reminder_logs   enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.meetings             enable row level security;
alter table public.boards               enable row level security;
alter table public.board_columns        enable row level security;
alter table public.tasks                enable row level security;
alter table public.task_assignees       enable row level security;
alter table public.documents            enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.rate_limits          enable row level security;
alter table public.cron_runs            enable row level security;

-- Also force RLS for table OWNERS, so a mistake that runs app SQL as the owner
-- role does not silently see everything. (service_role still bypasses — that is
-- exactly why every admin-client query must re-filter tenant_id in app code.)
alter table public.profiles             force row level security;
alter table public.attendance           force row level security;
alter table public.leaves               force row level security;
alter table public.payslips             force row level security;
alter table public.documents            force row level security;
alter table public.calendar_connections force row level security;

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants for select to authenticated
using (
  app.is_super_admin()
  or (id = app.current_tenant_id() and app.is_active_member())
);

-- An org edits only its OWN tenant (name, logo, colour, timezone, work start).
drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants for update to authenticated
using  (id = app.current_tenant_id() and app.is_org())
with check (id = app.current_tenant_id() and app.is_org());

-- No INSERT/DELETE policy: tenants are created by the provisioning trigger and
-- suspended/reactivated by the super admin through the service role.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (
  app.is_super_admin()
  -- Own row is always readable, even when deactivated, so the UI can explain
  -- WHY access was lost instead of showing an empty error.
  or id = auth.uid()
  -- Staff directory: everyone in an active tenant can see their colleagues
  -- (needed for task assignees, meeting attendees, notification targeting).
  or (tenant_id = app.current_tenant_id() and app.is_active_member())
);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
using (
  id = auth.uid()
  or (tenant_id = app.current_tenant_id() and app.is_org())
)
with check (
  id = auth.uid()
  or (tenant_id = app.current_tenant_id() and app.is_org())
);

-- No INSERT policy: profiles are created ONLY by handle_new_user() (003).
-- No DELETE policy: users are deactivated, never deleted, so history survives.

/**
 * Column guard. RLS decides WHICH ROWS you may touch; it cannot express "you may
 * not change THIS COLUMN". Without this, an employee could PATCH their own
 * profile row and set role='org' or is_active=true after being deactivated.
 */
create or replace function public.tg_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  -- Server-side/service-role paths (no end user in the request) already
  -- re-verify tenant_id in application code; let them through.
  if auth.uid() is null then
    return new;
  end if;

  -- Nobody may move a profile between tenants, ever.
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable';
  end if;

  if app.is_org() and old.tenant_id = app.current_tenant_id() then
    -- An org manages its people but cannot mint roles (that would let it create
    -- another org or a super admin inside its tenant).
    if new.role is distinct from old.role then
      raise exception 'role changes are not permitted from the client';
    end if;
    return new;
  end if;

  if auth.uid() = old.id then
    -- Self-service edits: contact details, photo, timezone, and clearing the
    -- forced-password-change flag. Everything else is privileged.
    if new.role          is distinct from old.role
       or new.is_active  is distinct from old.is_active
       or new.employee_code is distinct from old.employee_code
       or new.designation   is distinct from old.designation
       or new.department_id is distinct from old.department_id
       or new.date_of_joining is distinct from old.date_of_joining then
      raise exception 'You are not allowed to modify these profile fields';
    end if;
    return new;
  end if;

  raise exception 'Not permitted';
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- ---------------------------------------------------------------------------
-- departments
-- ---------------------------------------------------------------------------
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments for select to authenticated
using (
  app.is_super_admin()
  or (tenant_id = app.current_tenant_id() and app.is_active_member())
);

drop policy if exists departments_write on public.departments;
create policy departments_write on public.departments for all to authenticated
using  (tenant_id = app.current_tenant_id() and app.is_org())
with check (tenant_id = app.current_tenant_id() and app.is_org());

-- ---------------------------------------------------------------------------
-- attendance — org sees the whole tenant, an employee sees ONLY their own rows.
-- ---------------------------------------------------------------------------
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
using (
  app.is_super_admin()
  or (
    tenant_id = app.current_tenant_id()
    and app.is_active_member()
    and (app.is_org() or employee_id = auth.uid())
  )
);

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance for insert to authenticated
with check (
  tenant_id = app.current_tenant_id()
  and app.is_active_member()
  and (app.is_org() or employee_id = auth.uid())
);

drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance for update to authenticated
using (
  tenant_id = app.current_tenant_id()
  and app.is_active_member()
  and (app.is_org() or employee_id = auth.uid())
)
with check (
  tenant_id = app.current_tenant_id()
  and (app.is_org() or employee_id = auth.uid())
);

drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance for delete to authenticated
using (tenant_id = app.current_tenant_id() and app.is_org());

-- ---------------------------------------------------------------------------
-- leaves
-- ---------------------------------------------------------------------------
drop policy if exists leaves_select on public.leaves;
create policy leaves_select on public.leaves for select to authenticated
using (
  app.is_super_admin()
  or (
    tenant_id = app.current_tenant_id()
    and app.is_active_member()
    and (app.is_org() or employee_id = auth.uid())
  )
);

drop policy if exists leaves_insert on public.leaves;
create policy leaves_insert on public.leaves for insert to authenticated
with check (
  tenant_id = app.current_tenant_id()
  and app.is_active_member()
  and (app.is_org() or employee_id = auth.uid())
  -- An application always starts pending; only the org decides.
  and status = 'pending'
);

-- Only the org approves/rejects. Employees cannot UPDATE at all, so there is no
-- path for them to self-approve — they withdraw via DELETE below instead.
drop policy if exists leaves_update on public.leaves;
create policy leaves_update on public.leaves for update to authenticated
using  (tenant_id = app.current_tenant_id() and app.is_org())
with check (tenant_id = app.current_tenant_id() and app.is_org());

drop policy if exists leaves_delete on public.leaves;
create policy leaves_delete on public.leaves for delete to authenticated
using (
  tenant_id = app.current_tenant_id()
  and app.is_active_member()
  and (app.is_org() or (employee_id = auth.uid() and status = 'pending'))
);

-- ---------------------------------------------------------------------------
-- payslips — employees read their own; only the org uploads.
-- ---------------------------------------------------------------------------
drop policy if exists payslips_select on public.payslips;
create policy payslips_select on public.payslips for select to authenticated
using (
  app.is_super_admin()
  or (
    tenant_id = app.current_tenant_id()
    and app.is_active_member()
    and (app.is_org() or employee_id = auth.uid())
  )
);

drop policy if exists payslips_write on public.payslips;
create policy payslips_write on public.payslips for all to authenticated
using  (tenant_id = app.current_tenant_id() and app.is_org())
with check (tenant_id = app.current_tenant_id() and app.is_org());

-- ---------------------------------------------------------------------------
-- invoices — org-only business data; employees never see it.
-- ---------------------------------------------------------------------------
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select to authenticated
using (
  app.is_super_admin()
  or (tenant_id = app.current_tenant_id() and app.is_org())
);

drop policy if exists invoices_write on public.invoices;
create policy invoices_write on public.invoices for all to authenticated
using  (tenant_id = app.current_tenant_id() and app.is_org())
with check (tenant_id = app.current_tenant_id() and app.is_org());

-- ---------------------------------------------------------------------------
-- notifications — an employee sees only what was addressed to them.
-- ---------------------------------------------------------------------------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
using (
  app.is_super_admin()
  or (
    tenant_id = app.current_tenant_id()
    and app.is_active_member()
    and (
      app.is_org()
      or send_to_type = 'all'
      or (send_to_type = 'employee'   and target_id = auth.uid())
      or (send_to_type = 'department' and target_id = app.current_department_id())
    )
  )
);

drop policy if exists notifications_write on public.notifications;
create policy notifications_write on public.notifications for all to authenticated
using  (tenant_id = app.current_tenant_id() and app.is_org())
with check (tenant_id = app.current_tenant_id() and app.is_org());

drop policy if exists notification_reads_select on public.notification_reads;
create policy notification_reads_select on public.notification_reads for select to authenticated
using (
  user_id = auth.uid()
  or (tenant_id = app.current_tenant_id() and app.is_org())
);

drop policy if exists notification_reads_insert on public.notification_reads;
create policy notification_reads_insert on public.notification_reads for insert to authenticated
with check (
  user_id = auth.uid()
  and tenant_id = app.current_tenant_id()
  and app.is_active_member()
);

drop policy if exists notification_reads_delete on public.notification_reads;
create policy notification_reads_delete on public.notification_reads for delete to authenticated
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- work_authorizations / visa_reminder_logs
-- ---------------------------------------------------------------------------
drop policy if exists work_auth_select on public.work_authorizations;
create policy work_auth_select on public.work_authorizations for select to authenticated
using (
  app.is_super_admin()
  or (
    tenant_id = app.current_tenant_id()
    and app.is_active_member()
    and (app.is_org() or employee_id = auth.uid())
  )
);

drop policy if exists work_auth_write on public.work_authorizations;
create policy work_auth_write on public.work_authorizations for all to authenticated
using  (tenant_id = app.current_tenant_id() and app.is_org())
with check (tenant_id = app.current_tenant_id() and app.is_org());

-- Read-only to the app; rows are written exclusively by the cron (service role),
-- which is what makes UNIQUE(work_auth_id, milestone) the single source of truth.
drop policy if exists visa_logs_select on public.visa_reminder_logs;
create policy visa_logs_select on public.visa_reminder_logs for select to authenticated
using (
  app.is_super_admin()
  or (tenant_id = app.current_tenant_id() and app.is_org())
);

-- ---------------------------------------------------------------------------
-- calendar_connections — org-only, and the ENCRYPTED TOKEN COLUMN IS NOT
-- SELECTABLE by `authenticated` at all (column-level grant below). RLS controls
-- rows; only a column privilege can keep a ciphertext out of a client query.
-- ---------------------------------------------------------------------------
drop policy if exists calendar_connections_select on public.calendar_connections;
create policy calendar_connections_select on public.calendar_connections for select to authenticated
using (tenant_id = app.current_tenant_id() and app.is_org());

drop policy if exists calendar_connections_write on public.calendar_connections;
create policy calendar_connections_write on public.calendar_connections for all to authenticated
using  (tenant_id = app.current_tenant_id() and app.is_org())
with check (tenant_id = app.current_tenant_id() and app.is_org());

revoke select on public.calendar_connections from authenticated;
grant select (
  id, tenant_id, connected_by, google_email, google_channel_id,
  channel_expires_at, sync_token, last_synced_at, status, expires_at,
  created_at, updated_at
) on public.calendar_connections to authenticated;

-- ---------------------------------------------------------------------------
-- meetings — everyone in the tenant reads; only the org writes.
-- ---------------------------------------------------------------------------
drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings for select to authenticated
using (
  app.is_super_admin()
  or (tenant_id = app.current_tenant_id() and app.is_active_member())
);

drop policy if exists meetings_write on public.meetings;
create policy meetings_write on public.meetings for all to authenticated
using  (tenant_id = app.current_tenant_id() and app.is_org())
with check (tenant_id = app.current_tenant_id() and app.is_org());

-- ---------------------------------------------------------------------------
-- Kanban
-- ---------------------------------------------------------------------------
drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards for select to authenticated
using (
  app.is_super_admin()
  or (tenant_id = app.current_tenant_id() and app.is_active_member())
);

drop policy if exists boards_write on public.boards;
create policy boards_write on public.boards for all to authenticated
using  (tenant_id = app.current_tenant_id() and app.is_org())
with check (tenant_id = app.current_tenant_id() and app.is_org());

drop policy if exists board_columns_select on public.board_columns;
create policy board_columns_select on public.board_columns for select to authenticated
using (
  app.is_super_admin()
  or (tenant_id = app.current_tenant_id() and app.is_active_member())
);

drop policy if exists board_columns_write on public.board_columns;
create policy board_columns_write on public.board_columns for all to authenticated
using  (tenant_id = app.current_tenant_id() and app.is_org())
with check (tenant_id = app.current_tenant_id() and app.is_org());

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
using (
  app.is_super_admin()
  or (tenant_id = app.current_tenant_id() and app.is_active_member())
);

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
with check (tenant_id = app.current_tenant_id() and app.is_org());

-- The role rule the Kanban UI also enforces, restated where it actually binds:
-- an org moves/edits any card; an employee only the cards assigned to them.
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
using (
  tenant_id = app.current_tenant_id()
  and app.is_active_member()
  and (app.is_org() or app.is_task_assignee(id))
)
with check (
  tenant_id = app.current_tenant_id()
  and (app.is_org() or app.is_task_assignee(id))
);

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
using (tenant_id = app.current_tenant_id() and app.is_org());

drop policy if exists task_assignees_select on public.task_assignees;
create policy task_assignees_select on public.task_assignees for select to authenticated
using (
  app.is_super_admin()
  or (tenant_id = app.current_tenant_id() and app.is_active_member())
);

drop policy if exists task_assignees_write on public.task_assignees;
create policy task_assignees_write on public.task_assignees for all to authenticated
using  (tenant_id = app.current_tenant_id() and app.is_org())
with check (tenant_id = app.current_tenant_id() and app.is_org());

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
using (
  app.is_super_admin()
  or (
    tenant_id = app.current_tenant_id()
    and app.is_active_member()
    and (app.is_org() or owner_id = auth.uid() or employee_id = auth.uid())
  )
);

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
with check (
  tenant_id = app.current_tenant_id()
  and app.is_active_member()
  and (app.is_org() or owner_id = auth.uid())
);

drop policy if exists documents_write on public.documents;
create policy documents_write on public.documents for all to authenticated
using  (tenant_id = app.current_tenant_id() and app.is_org())
with check (tenant_id = app.current_tenant_id() and app.is_org());

-- ---------------------------------------------------------------------------
-- audit_logs — APPEND ONLY.
-- There is an INSERT path and a SELECT path and deliberately NO update or delete
-- policy. The privilege revoke below is the belt to that suspenders: even a
-- future policy mistake cannot make the trail mutable for app roles.
-- ---------------------------------------------------------------------------
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
using (
  app.is_super_admin()
  or (tenant_id = app.current_tenant_id() and app.is_org())
);

drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs for insert to authenticated
with check (
  app.is_active_member()
  and (
    tenant_id = app.current_tenant_id()
    or (app.is_super_admin() and tenant_id is null)
  )
);

revoke update, delete, truncate on public.audit_logs from authenticated, anon;

-- ---------------------------------------------------------------------------
-- cron_runs — super-admin visibility only; written by the service role.
-- ---------------------------------------------------------------------------
drop policy if exists cron_runs_select on public.cron_runs;
create policy cron_runs_select on public.cron_runs for select to authenticated
using (app.is_super_admin());

-- ---------------------------------------------------------------------------
-- rate_limits — RLS on with ZERO policies: unreachable for anon/authenticated.
-- Only the SECURITY DEFINER RPCs (called with the service role) touch it.
-- ---------------------------------------------------------------------------
revoke all on public.rate_limits from anon, authenticated;
revoke all on public.cron_runs   from anon;
revoke execute on function public.rate_limit_hit(text, integer, bigint)   from anon, authenticated, public;
revoke execute on function public.rate_limit_count(text, bigint)          from anon, authenticated, public;
revoke execute on function public.rate_limit_reset(text)                  from anon, authenticated, public;
grant  execute on function public.rate_limit_hit(text, integer, bigint)   to service_role;
grant  execute on function public.rate_limit_count(text, bigint)          to service_role;
grant  execute on function public.rate_limit_reset(text)                  to service_role;

-- ---------------------------------------------------------------------------
-- Blanket anon lockdown. Nothing in this product is public: every route is
-- behind a login. `anon` keeps only what Supabase Auth itself needs.
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke usage on schema app from anon;

-- ---------------------------------------------------------------------------
-- Realtime: publish only the tables the Kanban board and notification bell
-- subscribe to. Realtime applies the SELECT policies above to each subscriber,
-- so a tenant can never receive another tenant's change events.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.tasks';           exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.board_columns';   exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.task_assignees';  exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.notifications';   exception when duplicate_object then null; end;
  end if;
end $$;

-- Realtime needs the OLD row to evaluate SELECT policies on UPDATE/DELETE events.
alter table public.tasks          replica identity full;
alter table public.board_columns  replica identity full;
alter table public.notifications  replica identity full;
