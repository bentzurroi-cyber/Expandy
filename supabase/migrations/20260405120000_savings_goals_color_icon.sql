-- Visual customization for savings goals (assets + settings).

alter table public.savings_goals
  add column if not exists color text not null default '#10b981';

alter table public.savings_goals
  add column if not exists icon text not null default 'piggy-bank';
