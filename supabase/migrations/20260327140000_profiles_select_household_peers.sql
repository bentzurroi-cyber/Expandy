-- Allow users to SELECT other profiles that share their household_id (household member list).
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select using (
  auth.uid() = id
  or exists (
    select 1
    from public.profiles as me
    where me.id = auth.uid()
      and me.household_id = profiles.household_id
  )
);
