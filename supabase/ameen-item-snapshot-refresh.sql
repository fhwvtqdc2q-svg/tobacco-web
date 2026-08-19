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

-- Remove the legacy one-argument overload so no caller can bypass the trusted
-- sales-generation precondition after this migration is applied.
drop function if exists public.replace_ameen_item_snapshot(jsonb);

create or replace function public.replace_ameen_item_snapshot(
  p_rows jsonb,
  p_snapshot_window_start date,
  p_snapshot_window_end date,
  p_expected_sales_generation jsonb
)
returns table(row_count integer, generated_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_generated_at timestamptz;
  v_expected_source text;
  v_expected_sync_run_id uuid;
  v_expected_window_start date;
  v_expected_window_end date;
  v_expected_row_count integer;
  v_expected_completed_at timestamptz;
  v_current_source text;
  v_current_sync_run_id uuid;
  v_current_window_start date;
  v_current_window_end date;
  v_current_row_count integer;
  v_current_completed_at timestamptz;
  v_actual_sales_count integer;
  v_actual_source_key_count integer;
  v_actual_distinct_source_key_count integer;
begin
  if not (select public.ameen_item_snapshot_is_sync_writer()) then
    raise exception 'sync writer required';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'snapshot payload must be a non-empty array';
  end if;
  if p_snapshot_window_start is null or p_snapshot_window_end is null
     or (p_snapshot_window_end - p_snapshot_window_start) <> 30 then
    raise exception 'snapshot sales window must be exactly D-30..D';
  end if;
  if p_expected_sales_generation is null
     or jsonb_typeof(p_expected_sales_generation) <> 'object' then
    raise exception 'expected sales generation metadata is required';
  end if;

  begin
    v_expected_source := nullif(btrim(p_expected_sales_generation ->> 'source'), '');
    v_expected_sync_run_id := nullif(p_expected_sales_generation ->> 'sync_run_id', '')::uuid;
    v_expected_window_start := nullif(p_expected_sales_generation ->> 'window_start', '')::date;
    v_expected_window_end := nullif(p_expected_sales_generation ->> 'window_end', '')::date;
    v_expected_row_count := nullif(p_expected_sales_generation ->> 'row_count', '')::integer;
    v_expected_completed_at := nullif(p_expected_sales_generation ->> 'completed_at', '')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'expected sales generation metadata is invalid';
  end;
  if v_expected_source is null or v_expected_sync_run_id is null
     or v_expected_window_start is null or v_expected_window_end is null
     or v_expected_row_count is null or v_expected_row_count < 0
     or v_expected_completed_at is null then
    raise exception 'expected sales generation metadata is incomplete';
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

  -- Sales replacement and Snapshot publication take this one transaction-level
  -- lock in the same order. Once acquired, no Sales generation can commit until
  -- this function either publishes the verified Snapshot or rolls back.
  perform pg_advisory_xact_lock(hashtextextended('public.sales_line_items.atomic_refresh', 0));

  select s.source, s.sync_run_id, s.window_start, s.window_end,
         s.row_count, s.completed_at
    into v_current_source, v_current_sync_run_id, v_current_window_start,
         v_current_window_end, v_current_row_count, v_current_completed_at
  from public.sales_line_items_sync_state s
  where s.source = 'ameen_sales_line_items';
  if not found then
    raise exception 'trusted sales completion marker is missing';
  end if;
  if v_current_source is distinct from v_expected_source
     or v_current_sync_run_id is distinct from v_expected_sync_run_id
     or v_current_window_start is distinct from v_expected_window_start
     or v_current_window_end is distinct from v_expected_window_end
     or v_current_row_count is distinct from v_expected_row_count
     or v_current_completed_at is distinct from v_expected_completed_at then
    raise exception 'sales generation changed before snapshot publication';
  end if;
  if v_current_source <> 'ameen_sales_line_items'
     or v_current_window_start <> p_snapshot_window_start
     or v_current_window_end <> p_snapshot_window_end then
    raise exception 'trusted sales marker does not cover the full snapshot window';
  end if;
  if v_current_completed_at < clock_timestamp() - interval '75 minutes'
     or v_current_completed_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'trusted sales completion marker is stale or invalid';
  end if;

  select count(*)::integer, count(s.source_key)::integer,
         count(distinct s.source_key)::integer
    into v_actual_sales_count, v_actual_source_key_count,
         v_actual_distinct_source_key_count
  from public.sales_line_items s
  where s.sale_date >= p_snapshot_window_start
    and s.sale_date <= p_snapshot_window_end;
  if v_actual_sales_count <> v_current_row_count then
    raise exception 'trusted sales row_count no longer matches the full snapshot window';
  end if;
  if v_actual_source_key_count <> v_actual_sales_count
     or v_actual_distinct_source_key_count <> v_actual_sales_count then
    raise exception 'trusted sales source_key coverage is incomplete or duplicated';
  end if;

  delete from public.ameen_item_snapshot s
  where s.item_key is not null;
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

revoke all on function public.replace_ameen_item_snapshot(jsonb, date, date, jsonb)
  from public, anon, service_role;
grant execute on function public.replace_ameen_item_snapshot(jsonb, date, date, jsonb)
  to authenticated;

commit;
