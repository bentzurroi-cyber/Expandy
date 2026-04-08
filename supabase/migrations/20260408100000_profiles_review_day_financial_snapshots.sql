-- Day of month (1-31) to prompt financial review; optional per user profile.
alter table public.profiles
  add column if not exists review_day integer null;

alter table public.profiles
  drop constraint if exists profiles_review_day_range;

alter table public.profiles
  add constraint profiles_review_day_range
  check (review_day is null or (review_day >= 1 and review_day <= 31));

comment on column public.profiles.review_day is
  'Calendar day (1-31) for financial review reminder; null = off.';

-- Archived month-close snapshots (one row per household per reviewed month).
create table if not exists public.financial_review_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id text not null references public.households (code) on delete cascade,
  review_month text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint financial_review_snapshots_month_fmt check (review_month ~ '^\d{4}-\d{2}$'),
  constraint financial_review_snapshots_household_month unique (household_id, review_month)
);

create index if not exists idx_financial_review_snapshots_household
  on public.financial_review_snapshots (household_id, review_month desc);

alter table public.financial_review_snapshots enable row level security;

drop policy if exists "financial_review_snapshots_household_all" on public.financial_review_snapshots;

create policy "financial_review_snapshots_household_all"
  on public.financial_review_snapshots
  for all
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.household_id = financial_review_snapshots.household_id
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.household_id = financial_review_snapshots.household_id
    )
  );
