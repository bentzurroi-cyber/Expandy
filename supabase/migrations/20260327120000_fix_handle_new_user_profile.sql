-- Fix race where households insert used ON CONFLICT DO NOTHING and two profiles could share one code.
-- Apply in Supabase SQL editor or via CLI if you use migrations.

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  generated_code text;
begin
  <<alloc_loop>>
  loop
    loop
      generated_code := substring(translate(encode(gen_random_bytes(6), 'base64'), '+/=', 'XYZ') from 1 for 6);
      generated_code := upper(regexp_replace(generated_code, '[^A-Z0-9]', 'A', 'g'));
      exit when generated_code ~ '^[A-Z0-9]{6}$'
        and not exists (select 1 from public.households h where h.code = generated_code);
    end loop;
    begin
      insert into public.households (code, created_by)
      values (generated_code, new.id);
      exit alloc_loop;
    exception
      when unique_violation then
        null;
    end;
  end loop;

  insert into public.profiles (id, email, household_id, is_admin)
  values (
    new.id,
    coalesce(lower(new.email), ''),
    generated_code,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
