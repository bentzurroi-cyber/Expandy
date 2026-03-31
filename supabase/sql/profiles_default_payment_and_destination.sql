-- הרץ את כל הבלוק ב-Supabase → SQL Editor (או CLI migration).
-- מוסיף שני שדות לפרופיל המשתמש: ברירת מחדל לאמצעי תשלום (הוצאות) ולחשבון יעד (הכנסות).

alter table public.profiles
  add column if not exists default_payment_method_id text not null default '';

alter table public.profiles
  add column if not exists default_destination_account_id text not null default '';

comment on column public.profiles.default_payment_method_id is
  'Preferred payment_method id for new expense entries; empty = first in list.';

comment on column public.profiles.default_destination_account_id is
  'Preferred destination account id for new income entries; empty = first in list.';
