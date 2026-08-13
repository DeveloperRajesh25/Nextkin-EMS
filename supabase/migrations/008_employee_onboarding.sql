-- ============================================================================
-- NextKinLife EMS — 008_employee_onboarding.sql
-- The six-step employee onboarding wizard: a resumable DRAFT table, the profile
-- columns the wizard collects, and RLS for both.
--
-- WHY A DRAFT TABLE AND NOT A LONGER FORM
-- ---------------------------------------
-- Onboarding a person is a data-gathering exercise that spans days: the offer
-- letter arrives before the bank details, the visa copy after. A draft row lets
-- the org save what it has and come back, WITHOUT an auth account existing in
-- the meantime. Nothing in `auth.users` or `profiles` is created until
-- "Complete Onboarding" — so an abandoned draft leaves a deletable row and no
-- half-made account (the same rule the old 3-step wizard followed, now made
-- durable).
--
-- WHY THE COLUMNS ARE ALL NULLABLE
-- --------------------------------
-- "Required" is a property of COMPLETION, not of storage. A draft is by
-- definition incomplete, so the requiredness lives in the Zod step schemas
-- (src/lib/schemas.ts) which the complete endpoint re-runs server-side. Putting
-- NOT NULL here would make "Save for later" impossible, which is the feature.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles — the fields the wizard collects, added to the destination table.
-- ALTER ONLY. `profiles` is referenced by auth triggers and RLS policies that
-- must not be disturbed; every column is additive and nullable.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists preferred_first_name text;
alter table public.profiles add column if not exists preferred_last_name  text;
alter table public.profiles add column if not exists pronouns             text;
alter table public.profiles add column if not exists date_of_birth        date;
alter table public.profiles add column if not exists gender               text;
alter table public.profiles add column if not exists street_address       text;
alter table public.profiles add column if not exists apartment            text;
alter table public.profiles add column if not exists city                 text;
alter table public.profiles add column if not exists state_province       text;
alter table public.profiles add column if not exists zip_postal           text;
alter table public.profiles add column if not exists country              text;
alter table public.profiles add column if not exists home_phone           text;
alter table public.profiles add column if not exists work_phone           text;
alter table public.profiles add column if not exists work_email           text;
alter table public.profiles add column if not exists hire_date            date;
alter table public.profiles add column if not exists employment_status    text default 'Active';
alter table public.profiles add column if not exists reporting_manager_id uuid;
alter table public.profiles add column if not exists pay_type             text;
alter table public.profiles add column if not exists pay_rate             numeric;
alter table public.profiles add column if not exists pay_frequency        text;
alter table public.profiles add column if not exists employment_type      text;
alter table public.profiles add column if not exists bank_name            text;
alter table public.profiles add column if not exists account_holder_name  text;
-- AES-256-GCM ciphertext (`v1:iv:tag:ct`), never a plaintext account number.
alter table public.profiles add column if not exists account_number_enc   text;
alter table public.profiles add column if not exists routing_code         text;
alter table public.profiles add column if not exists account_type         text;
alter table public.profiles add column if not exists emergency_contact_name text;
alter table public.profiles add column if not exists emergency_relationship text;
alter table public.profiles add column if not exists emergency_phone      text;
alter table public.profiles add column if not exists emergency_email      text;
alter table public.profiles add column if not exists resume_url           text;
alter table public.profiles add column if not exists offer_letter_url     text;
alter table public.profiles add column if not exists id_proof_type        text;
alter table public.profiles add column if not exists id_proof_url         text;
alter table public.profiles add column if not exists additional_docs      jsonb default '[]'::jsonb;
alter table public.profiles add column if not exists internal_notes       text;
alter table public.profiles add column if not exists compliance_notes     text;
-- `photo_url` already exists on profiles (001) — deliberately not re-added.

-- A manager is another profile. ON DELETE SET NULL rather than CASCADE: losing
-- a manager must not delete their reports.
do $$ begin
  alter table public.profiles
    add constraint profiles_reporting_manager_fk
    foreign key (reporting_manager_id) references public.profiles(id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists profiles_reporting_manager_idx
  on public.profiles (reporting_manager_id) where reporting_manager_id is not null;

-- ---------------------------------------------------------------------------
-- employee_onboarding — one row per in-progress (or completed) onboarding.
-- ---------------------------------------------------------------------------
create table if not exists public.employee_onboarding (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  created_by  uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'draft'
              check (status in ('draft', 'completed', 'cancelled')),

  -- Step 1: Personal ------------------------------------------------------
  first_name           text,
  middle_name          text,
  last_name            text,
  date_of_birth        date,
  gender               text,
  preferred_first_name text,
  preferred_last_name  text,
  pronouns             text,
  street_address       text,
  apartment            text,
  city                 text,
  state_province       text,
  zip_postal           text,
  country              text default 'US',
  phone                text,
  home_phone           text,
  personal_email       text,
  internal_notes       text,

  -- Step 2: Work authorization -------------------------------------------
  visa_type         text,
  work_auth_status  text,
  visa_number       text,
  visa_start_date   date,
  visa_expiry_date  date,
  auth_document_url text,

  -- Step 3: Employment ----------------------------------------------------
  work_phone           text,
  work_email           text,
  hire_date            date,
  employment_status    text default 'Active',
  employee_code        text,
  department_id        uuid references public.departments(id) on delete set null,
  designation          text,
  reporting_manager_id uuid references public.profiles(id) on delete set null,

  -- Step 4: Compensation & banking ---------------------------------------
  pay_type            text,
  pay_rate            numeric,
  pay_frequency       text,
  employment_type     text,
  bank_name           text,
  account_holder_name text,
  -- Encrypted exactly as it will be on `profiles`, so completion is a copy and
  -- the plaintext exists only for the instant it is in the request body.
  account_number_enc  text,
  routing_code        text,
  account_type        text,
  emergency_contact_name text,
  emergency_relationship text,
  emergency_phone        text,
  emergency_email        text,

  -- Step 5: Documents -----------------------------------------------------
  photo_url        text,
  resume_url       text,
  offer_letter_url text,
  id_proof_type    text,
  id_proof_url     text,
  additional_docs  jsonb not null default '[]'::jsonb,
  compliance_notes text,

  -- Wizard state ----------------------------------------------------------
  current_step    integer not null default 1 check (current_step between 1 and 6),
  completed_steps jsonb   not null default '[]'::jsonb,

  -- Result ----------------------------------------------------------------
  employee_profile_id uuid references public.profiles(id) on delete set null,
  completed_at        timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A completed onboarding must point at the account it produced, and a draft
  -- must not claim one. Keeps "is this done?" answerable from one column.
  constraint employee_onboarding_completed_ck check (
    status <> 'completed'
    or (employee_profile_id is not null and completed_at is not null)
  )
);

drop trigger if exists set_updated_at on public.employee_onboarding;
create trigger set_updated_at before update on public.employee_onboarding
  for each row execute function public.tg_set_updated_at();

create index if not exists employee_onboarding_tenant_idx
  on public.employee_onboarding (tenant_id, status, updated_at desc);
create index if not exists employee_onboarding_creator_idx
  on public.employee_onboarding (created_by);

-- ---------------------------------------------------------------------------
-- RLS — tenant-scoped, org-role only.
--
-- Uses the app.* SECURITY DEFINER helpers from 002_rls.sql rather than reading
-- auth.jwt() inline: they carry the DB fallback for sessions minted before the
-- access-token hook, and `app.is_org()` also re-checks is_active / tenant
-- status live, which a raw claim read cannot do. Employees never see this
-- table — a draft holds bank details and admin-only notes about a person who is
-- not yet an account.
-- ---------------------------------------------------------------------------
alter table public.employee_onboarding enable row level security;
alter table public.employee_onboarding force row level security;

drop policy if exists employee_onboarding_select on public.employee_onboarding;
create policy employee_onboarding_select on public.employee_onboarding
  for select to authenticated
  using (app.is_super_admin() or (tenant_id = app.current_tenant_id() and app.is_org()));

drop policy if exists employee_onboarding_insert on public.employee_onboarding;
create policy employee_onboarding_insert on public.employee_onboarding
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and app.is_org() and created_by = auth.uid());

drop policy if exists employee_onboarding_update on public.employee_onboarding;
create policy employee_onboarding_update on public.employee_onboarding
  for update to authenticated
  using      (tenant_id = app.current_tenant_id() and app.is_org())
  with check (tenant_id = app.current_tenant_id() and app.is_org());

drop policy if exists employee_onboarding_delete on public.employee_onboarding;
create policy employee_onboarding_delete on public.employee_onboarding
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_org() and status <> 'completed');

grant select, insert, update, delete on public.employee_onboarding to authenticated;

-- The ciphertext columns are not readable by ordinary sessions at all — RLS
-- controls rows, only a COLUMN privilege keeps a ciphertext out of a client
-- query (the same treatment `calendar_connections.google_refresh_token_enc`
-- gets in 002_rls.sql). The wizard shows only the last four digits, derived
-- server-side after decrypting with the service role.
--
-- CONSEQUENCE: `select('*')` on either table now fails for `authenticated`.
-- Every query in the app already names its columns; keep it that way.
revoke select (account_number_enc) on public.employee_onboarding from authenticated;
revoke select (account_number_enc) on public.profiles from authenticated;
