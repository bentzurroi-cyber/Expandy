-- Client-synced prefs (budgets by month, deleted built-in category ids) on the signed-in user's profile row.
-- Replaces use of `public.settings` for this app.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS app_state jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.app_state IS
  'JSON blob merged by the app (budgets_by_month, deleted_builtin_*_ids, etc.).';
