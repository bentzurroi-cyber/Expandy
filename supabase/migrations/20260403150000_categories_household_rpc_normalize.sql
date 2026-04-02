-- Align join RPCs with household-scoped categories: unique (household_id, name, type).
-- Normalizes household codes like the app: trim, strip non-alphanumeric, uppercase, first 6 chars.

create or replace function public.normalize_household_code(p text)
returns text
language sql
immutable
as $$
  select case
    when p is null or btrim(p) = '' then ''
    else left(
      upper(regexp_replace(btrim(p), '[^A-Za-z0-9]', '', 'g')),
      6
    )
  end;
$$;

comment on function public.normalize_household_code(text) is
  'Matches app normalizeHouseholdCode: alphanumeric only, uppercase, max 6 chars.';

revoke all on function public.normalize_household_code(text) from public;
grant execute on function public.normalize_household_code(text) to authenticated;

-- Backfill categories missing household_id from owner profile (normalized).
update public.categories c
set household_id = public.normalize_household_code(p.household_id)
from public.profiles p
where c.user_id = p.id
  and (c.household_id is null or btrim(c.household_id) = '');

-- ---------------------------------------------------------------------------
-- submit_household_join_request (normalized codes + preview by requester's household)
-- ---------------------------------------------------------------------------
create or replace function public.submit_household_join_request(
  p_household_code text,
  p_import_previous_data boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := public.normalize_household_code(p_household_code);
  v_current text;
  v_current_norm text;
  v_existing uuid;
  v_email text;
  v_preview jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if length(v_code) <> 6 or v_code !~ '^[A-Z0-9]{6}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  if not exists (select 1 from public.households h where h.code = v_code) then
    return jsonb_build_object('ok', false, 'error', 'unknown_household');
  end if;

  select nullif(btrim(p.household_id), '') into v_current from public.profiles p where p.id = v_uid;
  v_current_norm := public.normalize_household_code(v_current);
  if v_current_norm = v_code then
    return jsonb_build_object('ok', false, 'error', 'already_member');
  end if;

  select r.id into v_existing
  from public.household_join_requests r
  where r.requester_id = v_uid and r.household_code = v_code and r.status = 'pending'
  limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'request_id', v_existing, 'duplicate', true);
  end if;

  select nullif(btrim(p.email), '') into v_email from public.profiles p where p.id = v_uid;

  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object('name', c.name, 'type', c.type) order by c.type, c.name
      )
      from public.categories c
      where c.user_id = v_uid
        and (
          length(v_current_norm) <> 6
          or c.household_id is null
          or btrim(c.household_id) = ''
          or public.normalize_household_code(c.household_id) = v_current_norm
        )
    ),
    '[]'::jsonb
  ) into v_preview;

  insert into public.household_join_requests (
    requester_id, household_code, import_previous_data, status, requester_email, category_preview
  )
  values (
    v_uid, v_code, coalesce(p_import_previous_data, false), 'pending',
    v_email, coalesce(v_preview, '[]'::jsonb)
  )
  returning id into v_existing;

  return jsonb_build_object('ok', true, 'request_id', v_existing);
end;
$$;

-- ---------------------------------------------------------------------------
-- reject_household_join_request (compare normalized household ids)
-- ---------------------------------------------------------------------------
create or replace function public.reject_household_join_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_my_household text;
  v_my_norm text;
  v_code text;
  v_code_norm text;
  v_n int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  select nullif(btrim(p.household_id), '') into v_my_household from public.profiles p where p.id = v_uid;
  v_my_norm := public.normalize_household_code(v_my_household);
  select r.household_code into v_code
  from public.household_join_requests r
  where r.id = p_request_id and r.status = 'pending';
  if v_code is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_code_norm := public.normalize_household_code(v_code);
  if length(v_my_norm) <> 6 or v_my_norm <> v_code_norm then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  update public.household_join_requests r
  set status = 'rejected', resolved_at = now(), resolved_by = v_uid
  where r.id = p_request_id and r.status = 'pending';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- approve_household_join_request
-- ---------------------------------------------------------------------------
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
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  select nullif(btrim(p.household_id), '') into v_my_household from public.profiles p where p.id = v_uid;
  v_my_norm := public.normalize_household_code(v_my_household);
  select * into v_req
  from public.household_join_requests r
  where r.id = p_request_id and r.status = 'pending';
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_target := public.normalize_household_code(v_req.household_code);
  if length(v_my_norm) <> 6 or v_my_norm <> v_target then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select nullif(btrim(p.household_id), '') into v_old_household
  from public.profiles p where p.id = v_req.requester_id;
  v_old_norm := public.normalize_household_code(v_old_household);

  if coalesce(v_req.import_previous_data, false) then
    if v_old_norm is not null and length(v_old_norm) = 6 and v_old_norm <> v_target then
      update public.expenses e
      set household_id = v_target
      where e.user_id = v_req.requester_id and public.normalize_household_code(e.household_id) = v_old_norm;
    end if;

    -- Point transactions at the canonical category row already in the target household (same name+type).
    update public.expenses e
    set
      category = ex.id,
      category_id = ex.id
    from public.categories jc, public.categories ex
    where e.user_id = v_req.requester_id
      and public.normalize_household_code(e.household_id) = v_target
      and (e.category = jc.id or e.category_id::text = jc.id)
      and jc.user_id = v_req.requester_id
      and ex.household_id = v_target
      and ex.type = jc.type
      and lower(btrim(ex.name)) = lower(btrim(jc.name))
      and jc.id <> ex.id;

    delete from public.categories jc
    where jc.user_id = v_req.requester_id
      and jc.household_id is distinct from v_target
      and exists (
        select 1 from public.categories k
        where k.household_id = v_target
          and k.type = jc.type
          and lower(btrim(k.name)) = lower(btrim(jc.name))
      );

    update public.categories c
    set household_id = v_target
    where c.user_id = v_req.requester_id
      and c.household_id is distinct from v_target;
  else
    delete from public.categories c
    where c.user_id = v_req.requester_id
      and (
        (v_old_norm is null or length(v_old_norm) <> 6)
          and (
            c.household_id is null
            or btrim(c.household_id) = ''
            or public.normalize_household_code(c.household_id) <> v_target
          )
        or (v_old_norm is not null and length(v_old_norm) = 6
          and public.normalize_household_code(c.household_id) = v_old_norm)
      );
  end if;

  update public.profiles p
  set household_id = v_target
  where p.id = v_req.requester_id;

  update public.household_join_requests r
  set status = 'approved', resolved_at = now(), resolved_by = v_uid
  where r.id = p_request_id;

  return jsonb_build_object('ok', true);
exception
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.submit_household_join_request(text, boolean) from public;
grant execute on function public.submit_household_join_request(text, boolean) to authenticated;
revoke all on function public.reject_household_join_request(uuid) from public;
grant execute on function public.reject_household_join_request(uuid) to authenticated;
revoke all on function public.approve_household_join_request(uuid) from public;
grant execute on function public.approve_household_join_request(uuid) to authenticated;

drop policy if exists "household_join_requests_select" on public.household_join_requests;
create policy "household_join_requests_select" on public.household_join_requests
for select to authenticated
using (
  requester_id = auth.uid()
  or household_code = public.normalize_household_code(public.current_profile_household_id())
);
