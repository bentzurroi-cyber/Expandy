-- Fix household member list: avoid RLS infinite recursion on profiles by using a SECURITY DEFINER helper.
create or replace function public.current_profile_household_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.household_id
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

comment on function public.current_profile_household_id() is
  'Returns auth.uid() profile household_id; bypasses RLS to avoid recursive profiles policies.';

revoke all on function public.current_profile_household_id() from public;
grant execute on function public.current_profile_household_id() to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or (
    coalesce(trim(household_id), '') <> ''
    and household_id = public.current_profile_household_id()
  )
);
