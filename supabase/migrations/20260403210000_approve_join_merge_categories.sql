-- approve_household_join_request: explicit import vs no-import category logic.
-- v_requester uuid from join row; v_target text = normalized household code.
-- Name match: lower(trim(coalesce(name,''))) on both sides.

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
  v_old_norm text;
  v_target text;
  v_requester uuid;
  v_import boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select nullif(btrim(p.household_id), '') into v_my_household
  from public.profiles p
  where p.id = v_uid;

  v_my_norm := public.normalize_household_code(v_my_household);

  select * into v_req
  from public.household_join_requests r
  where r.id = p_request_id and r.status = 'pending';

  if v_req.id is null then
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

  v_old_norm := public.normalize_household_code(v_old_household);

  -- -------------------------------------------------------------------------
  -- Always: approver's rows point at the target household (text).
  -- -------------------------------------------------------------------------
  update public.categories c
  set household_id = v_target::text
  where c.user_id = v_uid
    and public.normalize_household_code(coalesce(nullif(btrim(c.household_id), ''), '')) is distinct from v_target::text;

  if v_import then
    -- -----------------------------------------------------------------------
    -- Import: move requester's expenses into target household, then merge cats.
    -- -----------------------------------------------------------------------
    if v_old_norm is not null and length(v_old_norm) = 6 and v_old_norm <> v_target then
      update public.expenses e
      set household_id = v_target::text
      where e.user_id = v_requester
        and public.normalize_household_code(coalesce(nullif(btrim(e.household_id), ''), '')) = v_old_norm;
    end if;

    -- Point every expense at keeper category (same type + normalized name) in target household.
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

    -- Drop requester's duplicate rows (same normalized name+type already exists on target).
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

    -- Remaining requester-owned categories join the shared household.
    update public.categories c
    set household_id = v_target::text
    where c.user_id = v_requester
      and public.normalize_household_code(coalesce(nullif(btrim(c.household_id), ''), '')) is distinct from v_target::text;

  else
    -- -----------------------------------------------------------------------
    -- No import: remove all category rows owned by requester; they use the
    -- household list from approver (same household_id on approver's rows).
    -- -----------------------------------------------------------------------
    delete from public.categories c
    where c.user_id = v_requester;
  end if;

  update public.profiles p
  set household_id = v_target::text
  where p.id = v_requester;

  update public.household_join_requests r
  set status = 'approved', resolved_at = now(), resolved_by = v_uid
  where r.id = p_request_id;

  return jsonb_build_object('ok', true);
exception
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.approve_household_join_request(uuid) from public;
grant execute on function public.approve_household_join_request(uuid) to authenticated;
