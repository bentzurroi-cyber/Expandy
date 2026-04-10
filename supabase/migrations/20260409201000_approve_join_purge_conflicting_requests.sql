-- Prevent unique-constraint collisions on approval by purging older request
-- history for the same requester before marking the current request approved.

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
  v_requester_id uuid;
  v_import boolean;
  v_old_household text;
  v_old_norm text;
  v_profiles_updated int := 0;
  v_requests_updated int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select nullif(btrim(p.household_id), '') into v_my_household
  from public.profiles p
  where p.id = v_uid;
  v_my_norm := public.normalize_household_code(v_my_household);

  select
    r.id,
    r.requester_id,
    r.household_code,
    r.import_previous_data
  into v_req
  from public.household_join_requests r
  where r.id = p_request_id
    and r.status = 'pending'
  for update;

  if v_req.id is null then
    if exists (
      select 1
      from public.household_join_requests r
      where r.id = p_request_id
        and r.status <> 'pending'
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
  v_requester_id := v_requester;
  v_import := coalesce(v_req.import_previous_data, false);

  select nullif(btrim(p.household_id), '') into v_old_household
  from public.profiles p
  where p.id = v_requester;
  v_old_norm := public.normalize_household_code(v_old_household);

  if v_import then
    -- Merge mode: move requester's household-scoped data to target household.
    if to_regclass('public.budgets') is not null then
      if v_old_norm is not null and length(v_old_norm) = 6 and v_old_norm <> v_target then
        execute 'update public.budgets set household_id = $1 where user_id = $2 and household_id = $3'
          using v_target, v_requester, v_old_norm;
      else
        execute 'update public.budgets set household_id = $1 where user_id = $2'
          using v_target, v_requester;
      end if;
    end if;

    if to_regclass('public.recurring_expenses') is not null then
      if v_old_norm is not null and length(v_old_norm) = 6 and v_old_norm <> v_target then
        execute 'update public.recurring_expenses set household_id = $1 where user_id = $2 and household_id = $3'
          using v_target, v_requester, v_old_norm;
      else
        execute 'update public.recurring_expenses set household_id = $1 where user_id = $2'
          using v_target, v_requester;
      end if;
    end if;

    if v_old_norm is not null and length(v_old_norm) = 6 and v_old_norm <> v_target then
      update public.expenses e
      set household_id = v_target
      where e.user_id = v_requester
        and public.normalize_household_code(coalesce(nullif(btrim(e.household_id), ''), '')) = v_old_norm;

      update public.categories c
      set household_id = v_target
      where c.user_id = v_requester
        and public.normalize_household_code(coalesce(nullif(btrim(c.household_id), ''), '')) = v_old_norm;
    else
      update public.expenses e
      set household_id = v_target
      where e.user_id = v_requester;

      update public.categories c
      set household_id = v_target
      where c.user_id = v_requester;
    end if;
  else
    -- Clean-slate mode: delete in strict reverse-dependency order.
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
      delete from public.expenses e
      where e.user_id = v_requester;

      delete from public.categories c
      where c.user_id = v_requester;
    end if;
  end if;

  update public.profiles p
  set household_id = v_target
  where p.id = v_requester;
  get diagnostics v_profiles_updated = row_count;
  if v_profiles_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'requester_profile_not_updated');
  end if;

  -- Purge history for this requester to avoid unique collisions on approval.
  DELETE FROM public.household_join_requests
  WHERE requester_id = v_requester_id
    AND id != p_request_id;

  update public.household_join_requests r
  set status = 'approved', resolved_at = now(), resolved_by = v_uid
  where r.id = p_request_id
    and r.status = 'pending';
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
