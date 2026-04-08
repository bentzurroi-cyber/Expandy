-- Ensures savings_goals extension columns exist (priority, holding, ack, target_mode, monthly_mode only — no extra columns).
-- Run this if PostgREST reports missing columns on remote projects.

alter table public.savings_goals
  add column if not exists priority integer not null default 50
    check (priority >= 0 and priority <= 100000),
  add column if not exists holding_asset_type text null,
  add column if not exists monthly_investment_transfer_ack boolean not null default false,
  add column if not exists target_mode text not null default 'fixed'
    check (target_mode in ('fixed', 'open')),
  add column if not exists monthly_mode text not null default 'fixed'
    check (monthly_mode in ('fixed', 'surplus'));

-- Allow open-ended goals with target_amount = 0
alter table public.savings_goals drop constraint if exists savings_goals_target_amount_check;

alter table public.savings_goals
  add constraint savings_goals_target_amount_nonneg check (target_amount >= 0);
