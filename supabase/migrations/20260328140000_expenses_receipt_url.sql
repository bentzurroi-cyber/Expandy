-- Receipt image URL per expense (Supabase Storage public or signed URLs).
alter table public.expenses
  add column if not exists receipt_url text;

comment on column public.expenses.receipt_url is 'Optional URL to a receipt image in Storage (e.g. bucket receipts).';
