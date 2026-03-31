-- Multiple receipt images per expense (max 3 in app). Migrates legacy receipt_url.

alter table public.expenses
  add column if not exists receipt_urls text[];

update public.expenses
set receipt_urls = array[trim(both from receipt_url)]::text[]
where receipt_urls is null
  and receipt_url is not null
  and trim(both from receipt_url) <> '';

comment on column public.expenses.receipt_urls is 'Public URLs for receipt images in Storage (up to 3).';
