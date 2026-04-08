-- Priority (lower = filled first in partial surplus), optional holding type, monthly investment transfer ack (cleared with monthly rollover).
alter table public.savings_goals
  add column if not exists priority integer not null default 50
    check (priority >= 0 and priority <= 100000),
  add column if not exists holding_asset_type text null,
  add column if not exists monthly_investment_transfer_ack boolean not null default false;
