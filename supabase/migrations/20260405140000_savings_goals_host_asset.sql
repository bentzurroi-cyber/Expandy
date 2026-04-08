-- Link savings goal to a host asset (asset row id prefix / base id, text — matches public.assets.id style).

alter table public.savings_goals
  add column if not exists host_asset_id text null;
