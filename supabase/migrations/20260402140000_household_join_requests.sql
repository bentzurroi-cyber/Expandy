-- Pending household join requests + approve flow (categories + expenses).
-- Expects public.categories with user_id (per-user rows) as used by the app.
-- Ensures household_id exists on categories for RLS alignment when missing.

alter table public.categories add column if not exists household_id text;

update public.categories c
set household_id = nullif(trim(p.household_id), '')
from public.profiles p
where c.user_id is not null
  and p.id = c.user_id
  and (c.household_id is null or trim(c.household_id) = '');

create table if not exists public.household_join_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  household_code text not null references public.households (code) on delete cascade,
  import_previous_data boolean not null default false,
  requester_email text,
  category_preview jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);

alter table public.household_join_requests
  add column if not exists requester_email text;
alter table public.household_join_requests
  add column if not exists category_preview jsonb not null default '[]'::jsonb;

create unique index if not exists household_join_requests_one_pending
  on public.household_join_requests (requester_id, household_code)
  where status = 'pending';

alter table public.household_join_requests enable row level security;

drop policy if exists "household_join_requests_select" on public.household_join_requests;
create policy "household_join_requests_select" on public.household_join_requests
for select to authenticated
using (
  requester_id = auth.uid()
  or household_code = public.current_profile_household_id()
);

drop policy if exists "household_join_requests_insert" on public.household_join_requests;
create policy "household_join_requests_insert" on public.household_join_requests
for insert to authenticated
with check (requester_id = auth.uid());

-- No direct updates: use RPCs below.

-- ---------------------------------------------------------------------------
-- submit_household_join_request
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
  v_code text := upper(trim(p_household_code));
  v_current text;
  v_existing uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if v_code !~ '^[A-Z0-9]{6}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  if not exists (select 1 from public.households h where h.code = v_code) then
    return jsonb_build_object('ok', false, 'error', 'unknown_household');
  end if;

  select trim(p.household_id) into v_current from public.profiles p where p.id = v_uid;
  if v_current is not null and trim(v_current) = v_code then
    return jsonb_build_object('ok', false, 'error', 'already_member');
  end if;

  select r.id into v_existing
  from public.household_join_requests r
  where r.requester_id = v_uid and r.household_code = v_code and r.status = 'pending'
  limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'request_id', v_existing, 'duplicate', true);
  end if;

  select nullif(trim(p.email), '') into v_email from public.profiles p where p.id = v_uid;
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object('name', c.name, 'type', c.type) order by c.type, c.name
      )
      from public.categories c
      where c.user_id = v_uid
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

revoke all on function public.submit_household_join_request(text, boolean) from public;
grant execute on function public.submit_household_join_request(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_household_join_request (requester only)
-- ---------------------------------------------------------------------------
create or replace function public.cancel_household_join_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  update public.household_join_requests r
  set status = 'cancelled', resolved_at = now(), resolved_by = v_uid
  where r.id = p_request_id and r.requester_id = v_uid and r.status = 'pending';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found_or_forbidden');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.cancel_household_join_request(uuid) from public;
grant execute on function public.cancel_household_join_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reject_household_join_request (household member)
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
  v_code text;
  v_n int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  select trim(p.household_id) into v_my_household from public.profiles p where p.id = v_uid;
  select r.household_code into v_code
  from public.household_join_requests r
  where r.id = p_request_id and r.status = 'pending';
  if v_code is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_my_household is null or trim(v_my_household) <> v_code then
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

revoke all on function public.reject_household_join_request(uuid) from public;
grant execute on function public.reject_household_join_request(uuid) to authenticated;

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
  v_req record;
  v_old_household text;
  v_target text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  select trim(p.household_id) into v_my_household from public.profiles p where p.id = v_uid;
  select * into v_req
  from public.household_join_requests r
  where r.id = p_request_id and r.status = 'pending';
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_target := trim(v_req.household_code);
  if v_my_household is null or trim(v_my_household) <> v_target then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select nullif(trim(p.household_id), '') into v_old_household
  from public.profiles p where p.id = v_req.requester_id;

  if coalesce(v_req.import_previous_data, false) then
    if v_old_household is not null and v_old_household <> v_target then
      update public.expenses e
      set household_id = v_target
      where e.user_id = v_req.requester_id and e.household_id = v_old_household;
    end if;
    -- Add joiner's categories to approver's list (by name+type) when not already present on approver.
    insert into public.categories (id, user_id, name, type, color, icon, order_index, household_id)
    select gen_random_uuid()::text,
           v_uid,
           jc.name,
           jc.type,
           jc.color,
           coalesce(nullif(trim(jc.icon), ''), 'tag'),
           coalesce(jc.order_index, 0),
           v_target
    from public.categories jc
    where jc.user_id = v_req.requester_id
      and not exists (
        select 1 from public.categories mine
        where mine.user_id = v_uid
          and mine.type = jc.type
          and lower(trim(mine.name)) = lower(trim(jc.name))
      );
    update public.categories c
    set household_id = v_target
    where c.user_id = v_req.requester_id;
  else
    delete from public.categories c where c.user_id = v_req.requester_id;
    insert into public.categories (id, user_id, name, type, color, icon, order_index, household_id)
    select gen_random_uuid()::text,
           v_req.requester_id,
           c.name,
           c.type,
           c.color,
           coalesce(nullif(trim(c.icon), ''), 'tag'),
           coalesce(c.order_index, 0),
           v_target
    from public.categories c
    where c.user_id = v_uid;
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

revoke all on function public.approve_household_join_request(uuid) from public;
grant execute on function public.approve_household_join_request(uuid) to authenticated;
