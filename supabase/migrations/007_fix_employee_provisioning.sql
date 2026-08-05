-- ============================================================================
-- NextKinLife EMS — 007_fix_employee_provisioning.sql
--
-- FIXES A PRIVILEGE ESCALATION: every employee an org created became the OWNER
-- of a brand-new tenant of their own.
--
-- THE BUG
-- -------
-- `admin.createUser({ app_metadata })` is not one write. GoTrue INSERTs the
-- auth.users row and applies the custom app_metadata immediately AFTER, in a
-- separate UPDATE. `on_auth_user_created` is an AFTER INSERT trigger, so it ran
-- in the gap: `raw_app_meta_data ->> 'app_role'` was still null, the coalesce
-- fell through to its 'org' default, and provision_tenant_for_org() dutifully
-- built that "employee" a workspace. Verified against this project: a probe user
-- created with app_role=employee landed as role=org in a fresh tenant.
--
-- Reading the role from a TRUSTED source was never the flaw — the flaw was
-- reading it at a moment when the trusted source had not been written yet.
--
-- THE FIX, in two halves
-- ---------------------
--   1. Provisioning now requires POSITIVE evidence of a self-signup (`org_name`
--      in user metadata, which signUp() writes at INSERT time and the admin
--      employee path never sets) instead of treating "no evidence of anything"
--      as an org. Absence of data can no longer grant a workspace.
--   2. A new AFTER UPDATE trigger picks the role and tenant up the instant
--      GoTrue writes them, so admin-created accounts land correctly whichever
--      order the two writes happen in.
--
-- Both halves are needed. (1) alone would leave employees tenant-less; (2) alone
-- would still create the stray tenant and then abandon it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Provision only on positive evidence of an org self-signup.
-- ---------------------------------------------------------------------------

create or replace function public.provision_tenant_for_org()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_org_name text;
  v_app_role text;
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
         )), ''),
         nullif(u.raw_app_meta_data ->> 'app_role', '')
    into v_org_name, v_app_role
    from auth.users u
   where u.id = new.id;

  -- An account stamped with any app_role is admin-created and never self-signup,
  -- even if this row currently reads 'org' because the stamp landed late.
  if v_app_role is not null and v_app_role <> 'org' then
    return new;
  end if;

  -- THE GUARD THAT CLOSES THE HOLE. signUp() puts org_name in user metadata as
  -- part of the same INSERT, so a genuine self-signup always has it by now. An
  -- admin-created account never does. Previously a missing org_name only meant
  -- the tenant got named after the email local-part — a naming detail standing
  -- in for an authorization decision.
  if v_org_name is null then
    return new;
  end if;

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

-- ---------------------------------------------------------------------------
-- 2. Adopt the role and tenant when GoTrue writes them, however late.
-- ---------------------------------------------------------------------------

/**
 * Reconciles a profile with the TRUSTED app_metadata that arrived after insert.
 *
 * Deliberately narrow: it only fills in a profile that is still exactly as
 * handle_new_user() left it — the placeholder `role='org', tenant_id=null`. An
 * established org owner cannot be moved into another tenant by a later metadata
 * write, so this closes the timing hole without opening a re-homing one.
 */
create or replace function public.sync_profile_from_app_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_app_meta jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_role     public.user_role;
  v_tenant   uuid;
  v_must     boolean;
begin
  if nullif(v_app_meta ->> 'app_role', '') is null then
    return new;
  end if;

  begin
    v_role := (v_app_meta ->> 'app_role')::public.user_role;
  exception when others then
    return new;                      -- unrecognised role: change nothing
  end;

  begin
    v_tenant := nullif(v_app_meta ->> 'tenant_id', '')::uuid;
  exception when others then
    v_tenant := null;
  end;

  if v_role in ('org', 'super_admin') then
    v_tenant := null;
  elsif v_tenant is null then
    return new;                      -- employee with no tenant: nothing to adopt
  end if;

  v_must := coalesce((v_app_meta ->> 'must_change_password')::boolean, false);

  update public.profiles p
     set role                 = v_role,
         tenant_id            = v_tenant,
         must_change_password = v_must
   where p.id = new.id
     and p.role = 'org'
     and p.tenant_id is null       -- untouched placeholder only
     and (p.role, p.tenant_id) is distinct from (v_role, v_tenant);

  return new;
end;
$$;

drop trigger if exists on_auth_user_app_metadata_synced on auth.users;
create trigger on_auth_user_app_metadata_synced
  after update of raw_app_meta_data on auth.users
  for each row execute function public.sync_profile_from_app_metadata();

-- ---------------------------------------------------------------------------
-- 3. Repair the accounts already damaged.
-- ---------------------------------------------------------------------------

-- 3a. Put every mis-provisioned employee back in the tenant that hired them.
--     auth.users.raw_app_meta_data is service-role-only, so it is the authority
--     on who these accounts actually are.
update public.profiles p
   set role                 = 'employee',
       tenant_id            = (u.raw_app_meta_data ->> 'tenant_id')::uuid,
       must_change_password = coalesce(
         (u.raw_app_meta_data ->> 'must_change_password')::boolean, true)
  from auth.users u
 where u.id = p.id
   and u.raw_app_meta_data ->> 'app_role' = 'employee'
   and nullif(u.raw_app_meta_data ->> 'tenant_id', '') is not null
   and exists (
     select 1 from public.tenants t
      where t.id = (u.raw_app_meta_data ->> 'tenant_id')::uuid
   )
   and (
     p.role <> 'employee'
     or p.tenant_id is distinct from (u.raw_app_meta_data ->> 'tenant_id')::uuid
   );

-- 3b. Remove the workspaces that were conjured for those employees.
--     Only tenants with NO members survive this filter, so a real workspace
--     cannot be caught by it. Every child table cascades from tenants.
delete from public.tenants t
 where not exists (select 1 from public.profiles p where p.tenant_id = t.id);

-- 3c. What is left should make sense. Every row here is an employee sitting in
--     the tenant that created them.
select p.email, p.role, p.tenant_id, t.name as tenant_name
  from public.profiles p
  left join public.tenants t on t.id = p.tenant_id
 order by p.role, p.email;
