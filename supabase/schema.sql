-- Expandy Supabase schema for shared household sync (Roy & Noy)

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  household_id text not null,
  is_admin boolean not null default false
);

create table if not exists public.expenses (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  household_id text not null,
  amount numeric(14,2) not null,
  category text not null,
  date date not null,
  note text not null default '',
  currency text not null,
  is_verified boolean not null default false,
  installments_info jsonb not null default '{}'::jsonb,
  is_recurring boolean not null default false,
  payment_method_id text not null default '',
  entry_type text not null default 'expense',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assets (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  household_id text not null,
  name text not null,
  type text not null,
  balance numeric(14,2) not null,
  date date not null,
  color text,
  currency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id text primary key,
  household_id text not null,
  name text not null,
  type text not null,
  color text not null,
  icon text,
  order_index integer not null default 0,
  unique (household_id, type, name)
);

create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  household_id text not null unique,
  budget_limits jsonb not null default '{}'::jsonb,
  currencies_list jsonb not null default '[]'::jsonb,
  app_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_expenses_household_date on public.expenses (household_id, date desc);
create index if not exists idx_assets_household_date on public.assets (household_id, date desc);
create index if not exists idx_categories_household_type on public.categories (household_id, type);

alter table public.profiles enable row level security;
alter table public.expenses enable row level security;
alter table public.assets enable row level security;
alter table public.categories enable row level security;
alter table public.settings enable row level security;

-- profiles: users can read/write their profile.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select using (auth.uid() = id);
drop policy if exists "profiles_upsert_own" on public.profiles;
create policy "profiles_upsert_own" on public.profiles
for all using (auth.uid() = id) with check (auth.uid() = id);

-- household-shared access for data tables.
drop policy if exists "expenses_household_access" on public.expenses;
create policy "expenses_household_access" on public.expenses
for all using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.household_id = expenses.household_id
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.household_id = expenses.household_id
  )
);

drop policy if exists "assets_household_access" on public.assets;
create policy "assets_household_access" on public.assets
for all using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.household_id = assets.household_id
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.household_id = assets.household_id
  )
);

drop policy if exists "categories_household_access" on public.categories;
create policy "categories_household_access" on public.categories
for all using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.household_id = categories.household_id
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.household_id = categories.household_id
  )
);

drop policy if exists "settings_household_access" on public.settings;
create policy "settings_household_access" on public.settings
for all using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.household_id = settings.household_id
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.household_id = settings.household_id
  )
);

-- Optional but recommended: auto-create profile row on auth signup.
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, household_id, is_admin)
  values (
    new.id,
    coalesce(lower(new.email), ''),
    gen_random_uuid()::text,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();
