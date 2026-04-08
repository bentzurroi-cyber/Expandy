-- Track how much has been deposited toward this month's planned contribution.

alter table public.savings_goals
  add column if not exists monthly_current numeric(14, 2) not null default 0 check (monthly_current >= 0);

-- host_asset_id should be text (matches assets.id); safe no-op if already text
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'savings_goals'
      and column_name = 'host_asset_id'
      and data_type <> 'text'
  ) then
    alter table public.savings_goals
      alter column host_asset_id type text using host_asset_id::text;
  end if;
end $$;
