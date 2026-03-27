-- Let clients delete a households row only when no profile points at it (cleanup after sole member leaves).
drop policy if exists "households_delete_unreferenced" on public.households;
create policy "households_delete_unreferenced" on public.households
for delete using (
  not exists (
    select 1 from public.profiles p
    where p.household_id = households.code
  )
);
