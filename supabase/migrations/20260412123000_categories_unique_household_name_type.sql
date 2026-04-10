ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_user_id_name_type_key;
ALTER TABLE public.categories ADD CONSTRAINT categories_household_id_name_type_key UNIQUE (household_id, name, type);
