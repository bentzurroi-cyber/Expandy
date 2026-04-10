-- Smart-merge rewrite of approve_household_join_request.
--
-- import_data = true (Merge):
--   Loop every requester category in the old household.
--   If a same-name+type category already exists in target:
--     → remap requester's expenses/budgets/recurring_expenses to target category id
--     → delete requester's duplicate category
--   If no match:
--     → update requester's category household_id to target (safe, no collision)
--   Finally move all remaining expenses/budgets/recurring_expenses to target household.
--
-- import_data = false (Clean slate):
--   Delete in strict reverse-dependency order: budgets → recurring_expenses → expenses → categories.
--
-- Always: purge old request history before marking approved (avoids unique-constraint collision).

create or replace function public.approve_household_join_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_my_household text;
  v_my_norm text;
  v_req record;
  v_target text;
  v_requester uuid;
  v_import boolean;
  v_old_household text;
  v_old_norm text;
  v_profiles_updated int := 0;
  v_requests_updated int := 0;
  -- merge loop
  v_cat record;
  v_target_cat_id text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select nullif(btrim(p.household_id), '') into v_my_household
  from public.profiles p where p.id = v_uid;
  v_my_norm := public.normalize_household_code(v_my_household);

  -- Lock the pending request row.
  select r.id, r.requester_id, r.household_code, r.import_previous_data
  into v_req
  from public.household_join_requests r
  where r.id = p_request_id and r.status = 'pending'
  for update;

  if v_req.id is null then
    if exists (
      select 1 from public.household_join_requests r
      where r.id = p_request_id and r.status <> 'pending'
    ) then
      return jsonb_build_object('ok', false, 'error', 'request_already_processed');
    end if;
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_target := public.normalize_household_code(v_req.household_code)::text;
  if length(v_target) <> 6 or v_target !~ '^[A-Z0-9]{6}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_target_household');
  end if;
  if length(v_my_norm) <> 6 or v_my_norm <> v_target then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_requester := (v_req.requester_id)::uuid;
  v_import := coalesce(v_req.import_previous_data, false);

  select nullif(btrim(p.household_id), '') into v_old_household
  from public.profiles p where p.id = v_requester;
  v_old_norm := public.normalize_household_code(v_old_household);

  if v_import then
    -- -----------------------------------------------------------------------
    -- IMPORT = true: smart category merge then move remaining data.
    -- -----------------------------------------------------------------------

    -- Loop through every requester category in the old household.
    for v_cat in
      select c.id, c.name, c.type
      from public.categories c
      where c.user_id = v_requester
        and public.normalize_household_code(coalesce(nullif(btrim(c.household_id), ''), '')) = v_old_norm
    loop
      -- Check for an existing category in target with same name + type.
      select t.id::text into v_target_cat_id
      from public.categories t
      where t.household_id = v_target
        and lower(trim(t.type)) = lower(trim(v_cat.type))
        and lower(trim(t.name)) = lower(trim(v_cat.name))
      limit 1;

      if v_target_cat_id is not null then
        -- Collision: remap requester's expenses → target category id.
        update public.expenses e
        set
          category    = v_target_cat_id,
          category_id = v_target_cat_id::uuid
        where e.user_id = v_requester
          and (
            e.category = v_cat.id::text
            or (e.category_id is not null and e.category_id::text = v_cat.id::text)
          );

        -- Remap budgets if the table exists and has a category_id column.
        if to_regclass('public.budgets') is not null then
          execute '
            update public.budgets
            set category_id = $1
            where user_id = $2
              and category_id::text = $3
          ' using v_target_cat_id, v_requester, v_cat.id::text;
        end if;

        -- Remap recurring_expenses if exists.
        if to_regclass('public.recurring_expenses') is not null then
          execute '
            update public.recurring_expenses
            set category_id = $1
            where user_id = $2
              and category_id::text = $3
          ' using v_target_cat_id, v_requester, v_cat.id::text;
        end if;

        -- Delete the now-remapped duplicate category.
        delete from public.categories c
        where c.id::text = v_cat.id::text
          and c.user_id = v_requester;

      else
        -- No collision: move requester's category into target household.
        update public.categories c
        set household_id = v_target
        where c.id::text = v_cat.id::text
          and c.user_id = v_requester;
      end if;
    end loop;

    -- Move all remaining expenses to target household.
    update public.expenses e
    set household_id = v_target
    where e.user_id = v_requester
      and public.normalize_household_code(coalesce(nullif(btrim(e.household_id), ''), '')) = v_old_norm;

    -- Move budgets to target household.
    if to_regclass('public.budgets') is not null then
      execute '
        update public.budgets
        set household_id = $1
        where user_id = $2
          and household_id = $3
      ' using v_target, v_requester, v_old_norm;
    end if;

    -- Move recurring_expenses to target household.
    if to_regclass('public.recurring_expenses') is not null then
      execute '
        update public.recurring_expenses
        set household_id = $1
        where user_id = $2
          and household_id = $3
      ' using v_target, v_requester, v_old_norm;
    end if;

  else
    -- -----------------------------------------------------------------------
    -- IMPORT = false: clean slate — delete in strict reverse-dependency order.
    -- -----------------------------------------------------------------------
    if to_regclass('public.budgets') is not null then
      if v_old_norm is not null and length(v_old_norm) = 6 then
        execute 'delete from public.budgets where user_id = $1 and household_id = $2'
          using v_requester, v_old_norm;
      else
        execute 'delete from public.budgets where user_id = $1'
          using v_requester;
      end if;
    end if;

    if to_regclass('public.recurring_expenses') is not null then
      if v_old_norm is not null and length(v_old_norm) = 6 then
        execute 'delete from public.recurring_expenses where user_id = $1 and household_id = $2'
          using v_requester, v_old_norm;
      else
        execute 'delete from public.recurring_expenses where user_id = $1'
          using v_requester;
      end if;
    end if;

    if v_old_norm is not null and length(v_old_norm) = 6 then
      delete from public.expenses e
      where e.user_id = v_requester
        and public.normalize_household_code(coalesce(nullif(btrim(e.household_id), ''), '')) = v_old_norm;

      delete from public.categories c
      where c.user_id = v_requester
        and public.normalize_household_code(coalesce(nullif(btrim(c.household_id), ''), '')) = v_old_norm;
    else
      delete from public.expenses e where e.user_id = v_requester;
      delete from public.categories c where c.user_id = v_requester;
    end if;
  end if;

  -- -----------------------------------------------------------------------
  -- Move requester profile to target household.
  -- -----------------------------------------------------------------------
  update public.profiles p
  set household_id = v_target
  where p.id = v_requester;
  get diagnostics v_profiles_updated = row_count;
  if v_profiles_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'requester_profile_not_updated');
  end if;

  -- Purge historical request rows for this requester to prevent unique-constraint
  -- collisions on the final status update.
  delete from public.household_join_requests
  where requester_id = v_requester
    and id <> p_request_id;

  -- Mark current request approved.
  update public.household_join_requests r
  set status = 'approved', resolved_at = now(), resolved_by = v_uid
  where r.id = p_request_id and r.status = 'pending';
  get diagnostics v_requests_updated = row_count;
  if v_requests_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'request_already_processed');
  end if;

  return jsonb_build_object('ok', true);
exception
  when others then
    return jsonb_build_object('ok', false, 'error', 'sql_exception: ' || sqlerrm);
end;
$$;

revoke all on function public.approve_household_join_request(uuid) from public;
grant execute on function public.approve_household_join_request(uuid) to authenticated;
