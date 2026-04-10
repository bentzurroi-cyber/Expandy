-- Harden household-based RLS access for categories/expenses/budgets.
-- Users can access rows only when row.household_id equals their profile household_id.

alter table if exists public.categories enable row level security;
alter table if exists public.expenses enable row level security;

drop policy if exists "categories_household_access" on public.categories;
create policy "categories_household_access" on public.categories
for all
to authenticated
using (
  categories.household_id in (
    select p.household_id from public.profiles p where p.id = auth.uid()
  )
)
with check (
  categories.household_id in (
    select p.household_id from public.profiles p where p.id = auth.uid()
  )
);

drop policy if exists "expenses_household_access" on public.expenses;
create policy "expenses_household_access" on public.expenses
for all
to authenticated
using (
  expenses.household_id in (
    select p.household_id from public.profiles p where p.id = auth.uid()
  )
)
with check (
  expenses.household_id in (
    select p.household_id from public.profiles p where p.id = auth.uid()
  )
);

do $$
begin
  if to_regclass('public.budgets') is not null then
    execute 'alter table public.budgets enable row level security';
    execute 'drop policy if exists "budgets_household_access" on public.budgets';
    execute '
      create policy "budgets_household_access" on public.budgets
      for all
      to authenticated
      using (
        budgets.household_id in (
          select p.household_id from public.profiles p where p.id = auth.uid()
        )
      )
      with check (
        budgets.household_id in (
          select p.household_id from public.profiles p where p.id = auth.uid()
        )
      )
    ';
  end if;
end $$;
