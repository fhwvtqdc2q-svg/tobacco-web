-- Review and apply separately before registering the scheduled task.
-- The payload is staged and validated before an atomic transactional replacement.
begin;

alter table public.ameen_item_snapshot enable row level security;

-- Keep the existing authenticated SELECT policy, but remove every direct table
-- privilege that the snapshot producer does not need.
revoke all on table public.ameen_item_snapshot from public, anon, authenticated;
grant select, insert, delete on table public.ameen_item_snapshot to authenticated;

-- Server-side identity guard. This UUID is the established Supabase sync account
-- used by the other OZK sync-writer policies; it is never shipped to the frontend.
create or replace function public.ameen_item_snapshot_is_sync_writer()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select (select auth.uid()) = '9724dbe4-ecb0-49f7-a6b4-12f7f73c68f3'::uuid;
$$;

revoke all on function public.ameen_item_snapshot_is_sync_writer()
  from public, anon, service_role;
grant execute on function public.ameen_item_snapshot_is_sync_writer()
  to authenticated;

-- Replace the broad authenticated write policies. SELECT is deliberately untouched.
drop policy if exists "authenticated can insert ameen_item_snapshot"
  on public.ameen_item_snapshot;
drop policy if exists "authenticated can delete ameen_item_snapshot"
  on public.ameen_item_snapshot;
drop policy if exists "sync writer can insert ameen_item_snapshot"
  on public.ameen_item_snapshot;
drop policy if exists "sync writer can delete ameen_item_snapshot"
  on public.ameen_item_snapshot;

create policy "sync writer can insert ameen_item_snapshot"
  on public.ameen_item_snapshot
  for insert to authenticated
  with check ((select public.ameen_item_snapshot_is_sync_writer()));

create policy "sync writer can delete ameen_item_snapshot"
  on public.ameen_item_snapshot
  for delete to authenticated
  using ((select public.ameen_item_snapshot_is_sync_writer()));

create or replace function public.replace_ameen_item_snapshot(p_rows jsonb)
returns table(row_count integer, generated_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_generated_at timestamptz;
begin
  if not (select public.ameen_item_snapshot_is_sync_writer()) then
    raise exception 'sync writer required';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'snapshot payload must be a non-empty array';
  end if;

  create temporary table staged_ameen_item_snapshot on commit drop as
  select * from jsonb_to_recordset(p_rows) as x(
    id uuid, item_key text, item_guid text, item_number text, item_name text,
    unit1_name text, unit2_name text, unit2_factor numeric, stock_unit1 numeric,
    stock_unit2 numeric, last_purchase_price numeric, last_purchase_currency text,
    last_purchase_date date, last_purchase_unit text, average_cost numeric,
    average_cost_currency text, average_cost_basis text, last_supplier_name text,
    last_supplier_guid text, units_sold_30d numeric, movement_rank integer,
    generated_at timestamptz
  );

  select count(*), min(s.generated_at) into v_count, v_generated_at
  from pg_temp.staged_ameen_item_snapshot s;
  if v_count <> jsonb_array_length(p_rows) then raise exception 'payload row count mismatch'; end if;
  if exists (
    select 1
    from pg_temp.staged_ameen_item_snapshot s
    where nullif(btrim(s.item_key), '') is null
  ) then
    raise exception 'item_key is required';
  end if;
  if exists (
    select s.item_key
    from pg_temp.staged_ameen_item_snapshot s
    group by s.item_key
    having count(*) > 1
  ) then
    raise exception 'duplicate item_key in payload';
  end if;
  if exists (
    select 1
    from pg_temp.staged_ameen_item_snapshot s
    where s.units_sold_30d < 0
  ) then
    raise exception 'negative units_sold_30d is not allowed';
  end if;
  if (
    select count(distinct s.generated_at)
    from pg_temp.staged_ameen_item_snapshot s
  ) <> 1 then
    raise exception 'generated_at must be identical for all rows';
  end if;

  delete from public.ameen_item_snapshot;
  insert into public.ameen_item_snapshot (
    id, item_key, item_guid, item_number, item_name, unit1_name, unit2_name,
    unit2_factor, stock_unit1, stock_unit2, last_purchase_price,
    last_purchase_currency, last_purchase_date, last_purchase_unit, average_cost,
    average_cost_currency, average_cost_basis, last_supplier_name,
    last_supplier_guid, units_sold_30d, movement_rank, generated_at
  ) select s.id, s.item_key, s.item_guid, s.item_number, s.item_name, s.unit1_name, s.unit2_name,
    s.unit2_factor, s.stock_unit1, s.stock_unit2, s.last_purchase_price,
    s.last_purchase_currency, s.last_purchase_date, s.last_purchase_unit, s.average_cost,
    s.average_cost_currency, s.average_cost_basis, s.last_supplier_name,
    s.last_supplier_guid, s.units_sold_30d, s.movement_rank, s.generated_at
  from pg_temp.staged_ameen_item_snapshot s;
  return query select v_count, v_generated_at;
end;
$$;

revoke all on function public.replace_ameen_item_snapshot(jsonb)
  from public, anon, service_role;
grant execute on function public.replace_ameen_item_snapshot(jsonb) to authenticated;

commit;
