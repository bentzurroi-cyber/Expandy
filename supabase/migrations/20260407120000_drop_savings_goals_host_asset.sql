-- Remove linked-asset field from savings goals (simplified model).
alter table public.savings_goals
  drop column if exists host_asset_id;
