-- ============================================================================
-- NextKinLife EMS — 006_backfill_missing_profiles.sql
--
-- Repairs accounts that signed up BEFORE 003 was applied to this database.
--
-- `on_auth_user_created` only fires on INSERT into auth.users, so a user created
-- while the trigger was absent has an auth identity and no profile row for ever.
-- current_profile() then returns nothing, every guard refuses them, and they are
-- locked out of an account whose password is perfectly valid.
--
-- Idempotent: run it as many times as you like. It touches only users that have
-- no profile, and inserting the profile fires provision_tenant_for_org(), which
-- creates the workspace and seeds the default board exactly as a fresh signup
-- would.
--
-- ONLY self-signup (org) accounts are repaired. An employee row needs the
-- employing tenant's id, which lives in raw_app_meta_data and is only ever
-- stamped by the Admin API — if it is missing there is nothing to infer from,
-- and guessing would put someone in the wrong tenant. Those are listed by the
-- final query instead, to be re-invited through the app.
-- ============================================================================

insert into public.profiles (id, tenant_id, role, email, full_name, must_change_password)
select
  u.id,
  null,
  'org'::public.user_role,
  u.email,
  nullif(btrim(coalesce(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    ''
  )), ''),
  coalesce((u.raw_app_meta_data ->> 'must_change_password')::boolean, false)
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
  and u.deleted_at is null
  -- TRUSTED source only, same rule as handle_new_user(): anything not stamped by
  -- the Admin API is an ordinary org self-signup.
  and coalesce(nullif(u.raw_app_meta_data ->> 'app_role', ''), 'org') = 'org'
on conflict (id) do nothing;

-- Anything still profile-less needs a human. Expect zero rows.
select u.id, u.email, u.raw_app_meta_data ->> 'app_role' as app_role
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.id is null
   and u.deleted_at is null;
