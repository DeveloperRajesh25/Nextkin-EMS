-- ============================================================================
-- NextKinLife EMS — 003_auth_hook_and_triggers.sql
--
-- 1. custom_access_token_hook — puts tenant_id + user_role in every JWT so the
--    RLS helpers in 002 answer from a claim instead of a per-request query.
-- 2. handle_new_user       — auth.users INSERT  -> profiles row.
-- 3. provision_tenant_for_org — profiles INSERT -> tenants row (ORG SIGNUPS ONLY).
--
-- THE TRUST BOUNDARY THAT MATTERS HERE
-- ------------------------------------
-- `raw_user_meta_data` is whatever the CLIENT passed to signUp({ options.data }).
-- It is attacker-controlled. If handle_new_user read `role` from there, anyone
-- could self-signup as a super_admin. So:
--   • raw_app_meta_data  -> TRUSTED. Only the Admin API (service role) can set
--                           it, which is exactly how employees are created.
--   • raw_user_meta_data -> UNTRUSTED. We read only `org_name` / `full_name`
--                           from it, as plain display strings, and the role is
--                           FORCED to 'org' for every self-signup.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Custom access-token hook
-- ---------------------------------------------------------------------------

/**
 * Injects the caller's tenant and application role into the access token.
 *
 * The claim is `user_role`, NOT `role`. PostgREST reads the reserved `role`
 * claim and runs `SET ROLE <that value>` for the request — writing 'org' there
 * makes every single query fail with `role "org" does not exist`. Custom claims
 * must never shadow a reserved one.
 *
 * Enable it at: Dashboard -> Authentication -> Hooks -> Customize Access Token
 * (Postgres) -> public.custom_access_token_hook.
 */
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims    jsonb;
  v_tenant  uuid;
  v_role    text;
  v_active  boolean;
begin
  claims := coalesce(event -> 'claims', '{}'::jsonb);

  select p.tenant_id, p.role::text, p.is_active
    into v_tenant, v_role, v_active
    from public.profiles p
   where p.id = (event ->> 'user_id')::uuid;

  -- No profile yet (token minted in the same instant as the signup): hand the
  -- claims back untouched. The RLS helpers fall back to a table lookup, so the
  -- session still works; the next refresh picks the claims up.
  if v_role is null then
    return jsonb_set(event, '{claims}', claims);
  end if;

  claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
  claims := jsonb_set(
    claims,
    '{tenant_id}',
    case when v_tenant is null then 'null'::jsonb else to_jsonb(v_tenant::text) end
  );
  -- Advisory only. Authorization NEVER trusts this: a token lives an hour, so
  -- app.is_active_member() re-reads the table on every policy check.
  claims := jsonb_set(claims, '{is_active}', to_jsonb(coalesce(v_active, false)));

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- GoTrue runs the hook as `supabase_auth_admin`, which by default cannot see the
-- public schema. Grant exactly what the hook needs and nothing else.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

grant select on table public.profiles to supabase_auth_admin;

-- profiles has RLS forced, so the auth admin needs its own read policy.
drop policy if exists profiles_auth_admin_read on public.profiles;
create policy profiles_auth_admin_read on public.profiles
  for select to supabase_auth_admin using (true);

-- ---------------------------------------------------------------------------
-- 2. auth.users -> profiles
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_app_meta  jsonb := coalesce(new.raw_app_meta_data,  '{}'::jsonb);
  v_user_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role      public.user_role;
  v_tenant    uuid;
  v_must      boolean;
begin
  -- TRUSTED source only. Anything not explicitly stamped by the Admin API is an
  -- ordinary org self-signup.
  begin
    v_role := coalesce(nullif(v_app_meta ->> 'app_role', ''), 'org')::public.user_role;
  exception when others then
    v_role := 'org';
  end;

  begin
    v_tenant := nullif(v_app_meta ->> 'tenant_id', '')::uuid;
  exception when others then
    v_tenant := null;
  end;

  -- Defensive: a tenant id only ever accompanies an admin-created employee.
  if v_role = 'org' or v_role = 'super_admin' then
    v_tenant := null;
  end if;

  -- An employee with no tenant is nonsense — refuse rather than create an
  -- orphan the isolation model can't place.
  if v_role = 'employee' and v_tenant is null then
    raise exception 'employee accounts require a tenant_id in app_metadata';
  end if;

  v_must := coalesce((v_app_meta ->> 'must_change_password')::boolean, false);

  insert into public.profiles (id, tenant_id, role, email, full_name, must_change_password)
  values (
    new.id,
    v_tenant,
    v_role,
    new.email,
    nullif(btrim(coalesce(v_user_meta ->> 'full_name', v_user_meta ->> 'name', '')), ''),
    v_must
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 3. profiles -> tenants (ORG SIGNUPS ONLY)
-- ---------------------------------------------------------------------------

/** URL-safe slug from a display name, with a uniqueness suffix if needed. */
create or replace function public.tenant_slug_from(p_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text;
  v_slug text;
  v_n    integer := 0;
begin
  v_base := lower(btrim(coalesce(p_name, '')));
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := btrim(v_base, '-');
  v_base := left(v_base, 40);
  if v_base = '' or v_base !~ '^[a-z0-9]' then
    v_base := 'org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  end if;

  v_slug := v_base;
  while exists (select 1 from public.tenants t where t.slug = v_slug) loop
    v_n := v_n + 1;
    if v_n > 50 then
      v_slug := v_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
      exit;
    end if;
    v_slug := v_base || '-' || v_n::text;
  end loop;

  return v_slug;
end;
$$;

/**
 * Creates the tenant for a NEW ORG and seeds its starting data.
 *
 * The guard is the whole point: an employee row already arrives with the
 * employing org's tenant_id, and a super admin has none by design. Without the
 * early return, every employee added would silently spawn a second tenant and
 * the isolation model would come apart.
 */
create or replace function public.provision_tenant_for_org()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_org_name text;
  v_tenant_id uuid;
  v_board_id  uuid;
begin
  -- Only org signups, and only when a tenant does not already exist.
  if new.role <> 'org' or new.tenant_id is not null then
    return new;
  end if;

  select nullif(btrim(coalesce(
           u.raw_user_meta_data ->> 'org_name',
           u.raw_user_meta_data ->> 'organization_name',
           ''
         )), '')
    into v_org_name
    from auth.users u
   where u.id = new.id;

  v_org_name := coalesce(v_org_name, split_part(coalesce(new.email::text, 'organization'), '@', 1));

  insert into public.tenants (name, slug)
  values (left(v_org_name, 120), public.tenant_slug_from(v_org_name))
  returning id into v_tenant_id;

  update public.profiles
     set tenant_id = v_tenant_id,
         role      = 'org'
   where id = new.id;

  -- Seed the default Kanban board so the workspace is never an empty shell.
  insert into public.boards (tenant_id, name, created_by)
  values (v_tenant_id, 'Team Board', new.id)
  returning id into v_board_id;

  insert into public.board_columns (tenant_id, board_id, name, position)
  values
    (v_tenant_id, v_board_id, 'To Do',       0),
    (v_tenant_id, v_board_id, 'In Progress', 1),
    (v_tenant_id, v_board_id, 'Done',        2);

  insert into public.audit_logs (tenant_id, actor_id, actor_email, action, entity, entity_id, meta)
  values (v_tenant_id, new.id, new.email::text, 'tenant.provisioned', 'tenants', v_tenant_id,
          jsonb_build_object('name', v_org_name));

  return new;
end;
$$;

drop trigger if exists on_profile_created_provision_tenant on public.profiles;
create trigger on_profile_created_provision_tenant
  after insert on public.profiles
  for each row execute function public.provision_tenant_for_org();

-- ---------------------------------------------------------------------------
-- 4. The app's own "who am I".
--
-- SECURITY DEFINER on purpose: it must answer even when the caller has been
-- deactivated or their tenant suspended — precisely the states where the RLS
-- policies deny everything. Without it the UI could only render a blank error
-- instead of "your workspace is suspended, contact support". It returns ONLY the
-- caller's own row, so the bypass grants no extra reach.
-- ---------------------------------------------------------------------------
create or replace function public.current_profile()
returns table (
  id uuid,
  tenant_id uuid,
  role text,
  full_name text,
  email text,
  photo_url text,
  is_active boolean,
  must_change_password boolean,
  department_id uuid,
  tenant_name text,
  tenant_slug text,
  tenant_status text,
  tenant_logo_url text,
  tenant_primary_color text,
  tenant_timezone text,
  tenant_work_start_time text,
  tenant_onboarded boolean
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select p.id, p.tenant_id, p.role::text, p.full_name, p.email::text, p.photo_url,
         p.is_active, p.must_change_password, p.department_id,
         t.name, t.slug, t.status::text, t.logo_url, t.primary_color, t.timezone,
         to_char(t.work_start_time, 'HH24:MI'),
         (t.onboarded_at is not null)
    from public.profiles p
    left join public.tenants t on t.id = p.tenant_id
   where p.id = auth.uid();
$$;

revoke execute on function public.current_profile() from anon, public;
grant execute on function public.current_profile() to authenticated, service_role;
