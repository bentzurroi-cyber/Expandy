alter table public.profiles
  add column if not exists default_destination_account_id text not null default '';

comment on column public.profiles.default_destination_account_id is
  'Preferred destination account id for new income entries; empty = first in list.';
