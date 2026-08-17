-- Review and apply separately before registering the scheduled task.
-- The payload is staged and validated before an atomic transactional replacement.
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
  if (select auth.role()) <> 'authenticated' then raise exception 'authenticated role required'; end if;
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
  if exists (select 1 from pg_temp.staged_ameen_item_snapshot where nullif(btrim(item_key), '') is null) then
    raise exception 'item_key is required';
  end if;
  if exists (select item_key from pg_temp.staged_ameen_item_snapshot group by item_key having count(*) > 1) then
    raise exception 'duplicate item_key in payload';
  end if;
  if exists (select 1 from pg_temp.staged_ameen_item_snapshot where units_sold_30d < 0) then
    raise exception 'negative units_sold_30d is not allowed';
  end if;
  if (select count(distinct generated_at) from pg_temp.staged_ameen_item_snapshot) <> 1 then
    raise exception 'generated_at must be identical for all rows';
  end if;

  delete from public.ameen_item_snapshot;
  insert into public.ameen_item_snapshot (
    id, item_key, item_guid, item_number, item_name, unit1_name, unit2_name,
    unit2_factor, stock_unit1, stock_unit2, last_purchase_price,
    last_purchase_currency, last_purchase_date, last_purchase_unit, average_cost,
    average_cost_currency, average_cost_basis, last_supplier_name,
    last_supplier_guid, units_sold_30d, movement_rank, generated_at
  ) select id, item_key, item_guid, item_number, item_name, unit1_name, unit2_name,
    unit2_factor, stock_unit1, stock_unit2, last_purchase_price,
    last_purchase_currency, last_purchase_date, last_purchase_unit, average_cost,
    average_cost_currency, average_cost_basis, last_supplier_name,
    last_supplier_guid, units_sold_30d, movement_rank, generated_at
  from pg_temp.staged_ameen_item_snapshot;
  return query select v_count, v_generated_at;
end;
$$;

revoke all on function public.replace_ameen_item_snapshot(jsonb) from public;
grant execute on function public.replace_ameen_item_snapshot(jsonb) to authenticated;
