-- ============================================================================
-- NextKinLife EMS — 001_schema.sql
-- Tables, enums, indexes. Safe to run top-to-bottom; idempotent where practical.
--
-- Tenancy model: single database, shared schema. EVERY tenant-scoped table
-- carries a NOT NULL `tenant_id` with an index on it. RLS is enabled in
-- 002_rls.sql — this file only creates structure.
--
-- Time model: every instant is `timestamptz` (stored UTC). Anything that is a
-- calendar DAY in the org's local sense (attendance date, visa milestone) is a
-- plain `date` computed by the application in `tenants.timezone`, never in the
-- server's timezone.
-- ============================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid(), crypt()
create extension if not exists "citext";        -- case-insensitive email

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('super_admin', 'org', 'employee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tenant_status as enum ('active', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.leave_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_target as enum ('all', 'department', 'employee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.invoice_status as enum ('draft', 'sent', 'paid', 'overdue', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.calendar_status as enum ('connected', 'needs_reauth', 'revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.meeting_source as enum ('app', 'google');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.document_kind as enum ('general', 'employee_doc', 'work_auth', 'payslip');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Helper: keep updated_at fresh
-- ---------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- tenants — one row per customer organization. THE tenancy root.
-- ---------------------------------------------------------------------------
create table if not exists public.tenants (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 1 and 120),
  slug           text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  logo_url       text,
  -- Per-org theming: overrides the NextKinLife crimson inside this workspace.
  primary_color  text not null default '#C41E33' check (primary_color ~* '^#[0-9a-f]{6}$'),
  status         public.tenant_status not null default 'active',
  -- The org's wall-clock timezone. ALL date-based logic (attendance "day",
  -- late-login threshold, visa day-diff) is evaluated here, not on the server.
  timezone       text not null default 'Asia/Kolkata',
  -- Late-login threshold: a clock-in after this local time is flagged late.
  work_start_time time not null default '09:30',
  onboarded_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.tenants;
create trigger set_updated_at before update on public.tenants
  for each row execute function public.tg_set_updated_at();

create index if not exists tenants_status_idx     on public.tenants (status);
create index if not exists tenants_created_at_idx on public.tenants (created_at desc);

-- ---------------------------------------------------------------------------
-- profiles — 1:1 with auth.users. Holds tenant_id + role (mirrored into the JWT
-- by the custom access-token hook in 003).
--   super_admin -> tenant_id IS NULL
--   org         -> tenant_id = its own tenant
--   employee    -> tenant_id = the employing org's tenant
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  tenant_id            uuid references public.tenants(id) on delete cascade,
  role                 public.user_role not null default 'org',
  full_name            text,
  email                citext,
  phone                text,
  employee_code        text,
  designation          text,
  department_id        uuid,
  photo_url            text,
  is_active            boolean not null default true,
  must_change_password boolean not null default false,
  timezone             text not null default 'Asia/Kolkata',
  date_of_joining      date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Tenancy invariant:
  --   super_admin -> NEVER has a tenant (platform-wide oversight only)
  --   employee    -> ALWAYS has a tenant (admin-created into an existing one)
  --   org         -> tenant_id is NULL only in the instant between the
  --                  auth.users insert and the provisioning trigger in 003.
  constraint profiles_tenant_role_ck check (
    case role
      when 'super_admin' then tenant_id is null
      when 'employee'    then tenant_id is not null
      else true
    end
  )
);

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

create index if not exists profiles_tenant_idx        on public.profiles (tenant_id);
create index if not exists profiles_tenant_role_idx   on public.profiles (tenant_id, role);
create index if not exists profiles_tenant_active_idx on public.profiles (tenant_id, is_active);
create index if not exists profiles_email_idx         on public.profiles (email);
create index if not exists profiles_department_idx    on public.profiles (department_id);
create unique index if not exists profiles_tenant_employee_code_uidx
  on public.profiles (tenant_id, employee_code) where employee_code is not null;

-- ---------------------------------------------------------------------------
-- departments
-- ---------------------------------------------------------------------------
create table if not exists public.departments (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create index if not exists departments_tenant_idx on public.departments (tenant_id);
create unique index if not exists departments_tenant_name_uidx
  on public.departments (tenant_id, lower(name));

do $$ begin
  alter table public.profiles
    add constraint profiles_department_fk
    foreign key (department_id) references public.departments(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- attendance — one row per employee per local calendar day.
-- `date` is the day in the ORG's timezone, computed by the app on clock-in.
-- ---------------------------------------------------------------------------
create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  date        date not null,
  login_time  timestamptz not null,
  logout_time timestamptz,
  total_hours numeric(6,2),
  is_late     boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint attendance_logout_after_login_ck
    check (logout_time is null or logout_time >= login_time)
);

create unique index if not exists attendance_employee_date_uidx
  on public.attendance (tenant_id, employee_id, date);
create index if not exists attendance_tenant_date_idx on public.attendance (tenant_id, date desc);
create index if not exists attendance_employee_idx    on public.attendance (employee_id, date desc);

-- ---------------------------------------------------------------------------
-- leaves
-- ---------------------------------------------------------------------------
create table if not exists public.leaves (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  days        integer not null check (days > 0),
  reason      text not null check (length(btrim(reason)) between 1 and 2000),
  status      public.leave_status not null default 'pending',
  approver_id uuid references public.profiles(id) on delete set null,
  decision_note text,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint leaves_range_ck check (end_date >= start_date)
);

create index if not exists leaves_tenant_status_idx on public.leaves (tenant_id, status, created_at desc);
create index if not exists leaves_employee_idx      on public.leaves (employee_id, created_at desc);

-- ---------------------------------------------------------------------------
-- payslips — file_url stores the R2 OBJECT KEY (tenant_id/<uuid>.pdf), never a
-- public URL. Reads go through a signed URL minted after an authz check.
-- ---------------------------------------------------------------------------
create table if not exists public.payslips (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  month       integer not null check (month between 1 and 12),
  year        integer not null check (year between 2000 and 2200),
  file_url    text not null,
  file_name   text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create unique index if not exists payslips_employee_period_uidx
  on public.payslips (tenant_id, employee_id, year, month);
create index if not exists payslips_tenant_idx on public.payslips (tenant_id, year desc, month desc);

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  invoice_number text not null,
  bill_to        jsonb not null default '{}'::jsonb,
  items          jsonb not null default '[]'::jsonb,
  currency       text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  subtotal       numeric(14,2) not null default 0,
  tax_percent    numeric(6,3)  not null default 0 check (tax_percent >= 0 and tax_percent <= 100),
  total          numeric(14,2) not null default 0 check (total >= 0),
  amount_paid    numeric(14,2) not null default 0 check (amount_paid >= 0),
  balance_due    numeric(14,2) not null default 0,
  status         public.invoice_status not null default 'draft',
  issue_date     date not null default current_date,
  due_date       date,
  notes          text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint invoices_number_unique unique (tenant_id, invoice_number)
);

drop trigger if exists set_updated_at on public.invoices;
create trigger set_updated_at before update on public.invoices
  for each row execute function public.tg_set_updated_at();

create index if not exists invoices_tenant_idx        on public.invoices (tenant_id, issue_date desc);
create index if not exists invoices_tenant_status_idx on public.invoices (tenant_id, status);

-- ---------------------------------------------------------------------------
-- notifications (+ per-user read receipts)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 200),
  description  text,
  send_to_type public.notification_target not null default 'all',
  -- department id when send_to_type='department', profile id when 'employee',
  -- NULL when 'all'.
  target_id    uuid,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint notifications_target_ck check (
    (send_to_type = 'all' and target_id is null)
    or (send_to_type <> 'all' and target_id is not null)
  )
);

create index if not exists notifications_tenant_idx on public.notifications (tenant_id, created_at desc);
create index if not exists notifications_target_idx on public.notifications (tenant_id, send_to_type, target_id);

create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists notification_reads_user_idx   on public.notification_reads (user_id);
create index if not exists notification_reads_tenant_idx on public.notification_reads (tenant_id);

-- ---------------------------------------------------------------------------
-- work_authorizations (H-1B) + once-per-milestone reminder ledger
-- ---------------------------------------------------------------------------
create table if not exists public.work_authorizations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  employee_id   uuid not null references public.profiles(id) on delete cascade,
  visa_type     text not null default 'H-1B',
  visa_number   text,
  start_date    date,
  expiry_date   date not null,
  document_url  text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint work_auth_range_ck check (start_date is null or expiry_date >= start_date)
);

drop trigger if exists set_updated_at on public.work_authorizations;
create trigger set_updated_at before update on public.work_authorizations
  for each row execute function public.tg_set_updated_at();

create index if not exists work_auth_tenant_idx on public.work_authorizations (tenant_id, expiry_date);
create index if not exists work_auth_expiry_idx on public.work_authorizations (expiry_date);
create index if not exists work_auth_employee_idx on public.work_authorizations (employee_id);

-- The UNIQUE(work_auth_id, milestone) below is what makes the visa cron
-- idempotent FOREVER: a second attempt to log the same milestone conflicts, so
-- a duplicate email can never be sent even if the cron double-fires.
create table if not exists public.visa_reminder_logs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  employee_id  uuid not null references public.profiles(id) on delete cascade,
  work_auth_id uuid not null references public.work_authorizations(id) on delete cascade,
  milestone    integer not null check (milestone in (90, 30, 7, 0)),
  sent_at      timestamptz not null default now(),
  constraint visa_reminder_once unique (work_auth_id, milestone)
);

create index if not exists visa_reminder_tenant_idx on public.visa_reminder_logs (tenant_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- calendar_connections — one Google account per tenant.
-- The refresh token is stored AES-256-GCM encrypted (`v1:iv:tag:ct`).
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_connections (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  connected_by             uuid references public.profiles(id) on delete set null,
  google_email             text,
  google_refresh_token_enc text not null,
  google_channel_id        text,
  google_resource_id       text,
  channel_expires_at       timestamptz,
  sync_token               text,
  last_synced_at           timestamptz,
  status                   public.calendar_status not null default 'connected',
  expires_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint calendar_connections_one_per_tenant unique (tenant_id)
);

drop trigger if exists set_updated_at on public.calendar_connections;
create trigger set_updated_at before update on public.calendar_connections
  for each row execute function public.tg_set_updated_at();

create index if not exists calendar_connections_channel_idx
  on public.calendar_connections (google_channel_id) where google_channel_id is not null;
create index if not exists calendar_connections_status_idx
  on public.calendar_connections (status);

-- ---------------------------------------------------------------------------
-- meetings
-- ---------------------------------------------------------------------------
create table if not exists public.meetings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  title           text not null check (length(btrim(title)) between 1 and 200),
  description     text,
  location        text,
  meet_link       text,
  start_time      timestamptz not null,
  end_time        timestamptz not null,
  google_event_id text,
  organizer_id    uuid references public.profiles(id) on delete set null,
  attendees       jsonb not null default '[]'::jsonb,
  source          public.meeting_source not null default 'app',
  -- Google-owned events the app must not push back (avoids echo loops).
  read_only       boolean not null default false,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint meetings_time_ck check (end_time > start_time)
);

drop trigger if exists set_updated_at on public.meetings;
create trigger set_updated_at before update on public.meetings
  for each row execute function public.tg_set_updated_at();

create index if not exists meetings_tenant_start_idx on public.meetings (tenant_id, start_time desc);
create unique index if not exists meetings_google_event_uidx
  on public.meetings (tenant_id, google_event_id) where google_event_id is not null;

-- ---------------------------------------------------------------------------
-- Kanban: boards / columns / tasks / assignees
-- ---------------------------------------------------------------------------
create table if not exists public.boards (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 100),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists boards_tenant_idx on public.boards (tenant_id, created_at);

create table if not exists public.board_columns (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  board_id   uuid not null references public.boards(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 60),
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists board_columns_board_idx  on public.board_columns (board_id, position);
create index if not exists board_columns_tenant_idx on public.board_columns (tenant_id);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  board_id    uuid not null references public.boards(id) on delete cascade,
  column_id   uuid not null references public.board_columns(id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 200),
  description text,
  -- Fractional ordering: a drag between two cards averages their positions, so
  -- a move writes ONE row instead of renumbering the whole column.
  position    numeric(20,6) not null default 1000,
  priority    public.task_priority not null default 'medium',
  due_date    date,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.tasks;
create trigger set_updated_at before update on public.tasks
  for each row execute function public.tg_set_updated_at();

create index if not exists tasks_column_idx on public.tasks (column_id, position);
create index if not exists tasks_board_idx  on public.tasks (board_id);
create index if not exists tasks_tenant_idx on public.tasks (tenant_id);

create table if not exists public.task_assignees (
  task_id    uuid not null references public.tasks(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, profile_id)
);

create index if not exists task_assignees_profile_idx on public.task_assignees (profile_id);
create index if not exists task_assignees_tenant_idx  on public.task_assignees (tenant_id);

-- ---------------------------------------------------------------------------
-- documents — R2-backed files + server-extracted PDF text (searchable)
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  owner_id       uuid references public.profiles(id) on delete set null,
  -- The employee this document belongs to (wizard step 3 uploads), when any.
  employee_id    uuid references public.profiles(id) on delete cascade,
  kind           public.document_kind not null default 'general',
  file_url       text not null,          -- R2 object key
  file_name      text,                   -- original name, DISPLAY ONLY
  mime_type      text,
  size_bytes     bigint,
  extracted_text text,
  created_at     timestamptz not null default now()
);

create index if not exists documents_tenant_idx   on public.documents (tenant_id, created_at desc);
create index if not exists documents_employee_idx on public.documents (employee_id);
create index if not exists documents_text_idx
  on public.documents using gin (to_tsvector('english', coalesce(extracted_text, '')));

-- ---------------------------------------------------------------------------
-- audit_logs — APPEND ONLY. 002 grants INSERT/SELECT and deliberately creates
-- NO update/delete policy, and revokes those privileges outright.
-- tenant_id is nullable: platform-level events (super admin) have no tenant.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid references public.tenants(id) on delete set null,
  actor_id   uuid references public.profiles(id) on delete set null,
  actor_email text,
  action     text not null,
  entity     text,
  entity_id  uuid,
  ip         text,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_tenant_idx  on public.audit_logs (tenant_id, created_at desc);
create index if not exists audit_logs_actor_idx   on public.audit_logs (actor_id, created_at desc);
create index if not exists audit_logs_action_idx  on public.audit_logs (action, created_at desc);

-- ---------------------------------------------------------------------------
-- rate_limits — durable, shared-across-instances limiter backing §3's
-- login/signup/reset throttling and the enumeration-safe lockout. Keyed by an
-- opaque string (never a raw email; callers hash it).
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  key        text not null,
  hit_at     timestamptz not null default now(),
  id         bigserial primary key
);

create index if not exists rate_limits_key_time_idx on public.rate_limits (key, hit_at desc);

/**
 * Atomically record a hit and report whether the caller is within `p_limit`
 * hits per `p_window_ms`. Returns TRUE when admitted.
 *
 * SECURITY DEFINER so anon/authenticated can be throttled without granting them
 * any table privilege on rate_limits.
 */
create or replace function public.rate_limit_hit(
  p_key text,
  p_limit integer,
  p_window_ms bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff timestamptz := now() - make_interval(secs => p_window_ms / 1000.0);
  v_count  integer;
begin
  -- Opportunistic GC so the table cannot grow unbounded.
  delete from public.rate_limits
    where key = p_key and hit_at < now() - interval '24 hours';

  select count(*) into v_count
    from public.rate_limits
    where key = p_key and hit_at >= v_cutoff;

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.rate_limits (key) values (p_key);
  return true;
end;
$$;

/** Read-only hit count in the window — used by the failure-based login lockout. */
create or replace function public.rate_limit_count(p_key text, p_window_ms bigint)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
    from public.rate_limits
   where key = p_key
     and hit_at >= now() - make_interval(secs => p_window_ms / 1000.0);
$$;

/** Clear a lockout bucket (called after a SUCCESSFUL login). */
create or replace function public.rate_limit_reset(p_key text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.rate_limits where key = p_key;
$$;

-- ---------------------------------------------------------------------------
-- cron_runs — every authenticated cron invocation records its outcome so a
-- silently-failing job is visible in the super-admin console (§8).
-- ---------------------------------------------------------------------------
create table if not exists public.cron_runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,
  ok          boolean not null,
  duration_ms integer,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists cron_runs_job_idx on public.cron_runs (job, created_at desc);
