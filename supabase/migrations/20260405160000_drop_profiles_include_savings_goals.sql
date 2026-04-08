-- Savings goal balances belong in asset rows; avoid double-counting in net worth.

alter table public.profiles
  drop column if exists include_savings_goals_in_assets_total;
