-- Savings goals per household + optional inclusion in assets headline total.

create extension if not exists "pgcrypto";

create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  household_id text not null,
  name text not null,
  target_amount numeric(14, 2) not null check (target_amount > 0),
  current_amount numeric(14, 2) not null default 0 check (current_amount >= 0),
  monthly_contribution numeric(14, 2) not null default 0 check (monthly_contribution >= 0),
  target_date date null,
  is_investment_portfolio boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_savings_goals_household
  on public.savings_goals (household_id);

alter table public.savings_goals enable row level security;

drop policy if exists "savings_goals_household_access" on public.savings_goals;

create policy "savings_goals_household_access" on public.savings_goals
for all
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.household_id = savings_goals.household_id
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.household_id = savings_goals.household_id
  )
);

alter table public.profiles
  add column if not exists include_savings_goals_in_assets_total boolean not null default false;
