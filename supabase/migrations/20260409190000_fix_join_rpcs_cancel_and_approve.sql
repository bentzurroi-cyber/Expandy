-- Fix join-flow RPC availability and harden approval execution.
-- 1) Ensure cancel_household_join_request(p_request_id uuid) exists with exact signature.
-- 2) Re-publish approve_household_join_request with explicit SECURITY DEFINER behavior
--    and strict row-count checks for clearer failure modes.

create or replace function public.cancel_household_join_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  delete from public.household_join_requests r
  where r.id = p_request_id
    and r.requester_id = v_uid;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found_or_forbidden');
  end if;

  return jsonb_build_object('ok', true);
exception
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.cancel_household_join_request(uuid) from public;
grant execute on function public.cancel_household_join_request(uuid) to authenticated;


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
  v_old_household text;
  requester_old_household_id text;
  v_old_norm text;
  v_target text;
  v_requester uuid;
  v_import boolean;
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
        and r.status = 'approved'
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
  from public.profiles p
  where p.id = v_requester;
  requester_old_household_id := public.normalize_household_code(v_old_household);
  v_old_norm := public.normalize_household_code(v_old_household);

  update public.categories c
  set household_id = v_target::text
  where c.user_id = v_uid
    and public.normalize_household_code(coalesce(nullif(btrim(c.household_id), ''), '')) is distinct from v_target::text;

  if v_import then
    if v_old_norm is not null and length(v_old_norm) = 6 and v_old_norm <> v_target then
      update public.expenses e
      set household_id = v_target::text
      where e.user_id = v_requester
        and public.normalize_household_code(coalesce(nullif(btrim(e.household_id), ''), '')) = v_old_norm;
    end if;

    update public.expenses e
    set
      category = (ex.id)::text,
      category_id = (ex.id)::uuid
    from public.categories jc
    inner join lateral (
      select c2.id as keeper_id
      from public.categories c2
      where public.normalize_household_code(coalesce(nullif(btrim(c2.household_id), ''), '')) = v_target::text
        and c2.type = jc.type
        and lower(trim(coalesce(c2.name, ''))) = lower(trim(coalesce(jc.name, '')))
      order by case when c2.user_id = v_uid then 0 else 1 end, (c2.id)::text
      limit 1
    ) k on k.keeper_id is not null
    inner join public.categories ex on (ex.id)::text = (k.keeper_id)::text
    where jc.user_id = v_requester
      and (jc.id)::text <> (ex.id)::text
      and (
        (e.category)::text = (jc.id)::text
        or (
          e.category_id is not null
          and (e.category_id)::text = (jc.id)::text
        )
      );

    delete from public.categories jc
    where jc.user_id = v_requester
      and exists (
        select 1
        from public.categories k
        where public.normalize_household_code(coalesce(nullif(btrim(k.household_id), ''), '')) = v_target::text
          and k.type = jc.type
          and lower(trim(coalesce(k.name, ''))) = lower(trim(coalesce(jc.name, '')))
          and (k.id)::text <> (jc.id)::text
      );

    update public.categories c
    set household_id = v_target::text
    where c.user_id = v_requester
      and public.normalize_household_code(coalesce(nullif(btrim(c.household_id), ''), '')) is distinct from v_target::text;
  else
    if requester_old_household_id is not null and length(requester_old_household_id) = 6 then
      delete from public.expenses
      where household_id = requester_old_household_id
        and user_id = v_requester;

      delete from public.categories
      where household_id = requester_old_household_id
        and user_id = v_requester;
    else
      delete from public.expenses e
      where e.user_id = v_requester;

      delete from public.categories c
      where c.user_id = v_requester;
    end if;
  end if;

  update public.profiles p
  set household_id = v_target::text
  where p.id = v_requester;
  get diagnostics v_profiles_updated = row_count;
  if v_profiles_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'requester_profile_not_updated');
  end if;

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
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.approve_household_join_request(uuid) from public;
grant execute on function public.approve_household_join_request(uuid) to authenticated;
