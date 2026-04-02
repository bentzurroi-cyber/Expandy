-- Per-user preference: exclude one asset type from the "total net worth" headline (e.g. pension).
alter table public.profiles
  add column if not exists assets_total_exclude_type_id text not null default '';

comment on column public.profiles.assets_total_exclude_type_id is
  'When set to a built-in or custom asset type id, the assets screen total excludes balances of that type; empty = include all.';
