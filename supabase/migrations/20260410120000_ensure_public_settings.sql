-- Household-level JSON state (budgets presets, deleted builtin ids, etc.).
-- `review_day` and per-user defaults live on `public.profiles`, not here.

CREATE TABLE IF NOT EXISTS public.settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id text NOT NULL UNIQUE,
  budget_limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  currencies_list jsonb NOT NULL DEFAULT '[]'::jsonb,
  app_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS budget_limits jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS currencies_list jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS app_state jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_household_access" ON public.settings;
CREATE POLICY "settings_household_access" ON public.settings
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.household_id = settings.household_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.household_id = settings.household_id
  )
);
