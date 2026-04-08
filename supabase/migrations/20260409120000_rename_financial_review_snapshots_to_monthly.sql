-- Canonical name for month-close archive rows (payload JSON includes assets, totals, goals).
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'financial_review_snapshots'
  )
  and not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'monthly_snapshots'
  ) then
    alter table public.financial_review_snapshots rename to monthly_snapshots;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'monthly_snapshots'
  ) then
    drop policy if exists "financial_review_snapshots_household_all" on public.monthly_snapshots;
    drop policy if exists "monthly_snapshots_household_all" on public.monthly_snapshots;

    create policy "monthly_snapshots_household_all"
      on public.monthly_snapshots
      for all
      using (
        exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.household_id = monthly_snapshots.household_id
        )
      )
      with check (
        exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.household_id = monthly_snapshots.household_id
        )
      );
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'idx_financial_review_snapshots_household'
  ) then
    alter index public.idx_financial_review_snapshots_household
      rename to idx_monthly_snapshots_household;
  end if;
end $$;
