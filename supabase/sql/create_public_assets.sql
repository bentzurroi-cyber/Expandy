-- Run in Supabase SQL Editor if `public.assets` is missing (schema cache / new project).
-- Matches app + `supabase/schema.sql`: balance = stored value in ILS after FX on write.

create extension if not exists "pgcrypto";

create table if not exists public.assets (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  household_id text not null,
  name text not null,
  type text not null,
  balance numeric(14, 2) not null,
  date date not null,
  color text,
  currency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_assets_household_date
  on public.assets (household_id, date desc);

alter table public.assets enable row level security;

drop policy if exists "assets_household_access" on public.assets;

create policy "assets_household_access" on public.assets
for all
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.household_id = assets.household_id
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.household_id = assets.household_id
  )
);
