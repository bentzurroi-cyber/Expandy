alter table if exists public.expenses
add column if not exists is_reviewed boolean not null default false;

