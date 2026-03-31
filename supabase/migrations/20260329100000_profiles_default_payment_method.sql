-- Per-user default expense payment method (shared household: each member picks their own).
alter table public.profiles
  add column if not exists default_payment_method_id text not null default '';

comment on column public.profiles.default_payment_method_id is
  'Preferred payment_method id for new expense entries; empty = use first available.';
