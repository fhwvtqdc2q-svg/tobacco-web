import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = await readFile(
  path.join(repoRoot, 'supabase', 'ameen-item-snapshot-refresh.sql'),
  'utf8',
);

const helper = sql.match(
  /create or replace function public\.ameen_item_snapshot_is_sync_writer\(\)[\s\S]*?\$\$;/i,
)?.[0];
assert.ok(helper, 'sync-writer helper must exist');
assert.match(helper, /\bstable\b/i);
assert.match(helper, /\bsecurity invoker\b/i);
assert.doesNotMatch(helper, /auth\.jwt|email/i);
const syncUid = helper.match(/auth\.uid\(\)\)\s*=\s*'([0-9a-f-]{36})'::uuid/i)?.[1];
assert.ok(syncUid, 'sync-writer helper must compare auth.uid() with one fixed UUID');

assert.match(
  sql,
  /revoke all on table public\.ameen_item_snapshot from public, anon, authenticated;/i,
);
assert.match(
  sql,
  /grant select, insert, delete on table public\.ameen_item_snapshot to authenticated;/i,
);
assert.doesNotMatch(sql, /grant[^;]*(?:update|truncate)[^;]*to authenticated/i);
assert.doesNotMatch(sql, /drop policy[^;]*select[^;]*ameen_item_snapshot/i);

const insertPolicy = sql.match(
  /create policy "sync writer can insert ameen_item_snapshot"[\s\S]*?;/i,
)?.[0];
const deletePolicy = sql.match(
  /create policy "sync writer can delete ameen_item_snapshot"[\s\S]*?;/i,
)?.[0];
assert.match(insertPolicy ?? '', /for insert to authenticated[\s\S]*with check \(\(select public\.ameen_item_snapshot_is_sync_writer\(\)\)\)/i);
assert.match(deletePolicy ?? '', /for delete to authenticated[\s\S]*using \(\(select public\.ameen_item_snapshot_is_sync_writer\(\)\)\)/i);
assert.doesNotMatch(`${insertPolicy}\n${deletePolicy}`, /auth\.role|using\s*\(?(?:true|auth\.role)|with check\s*\(?auth\.role/i);
assert.doesNotMatch(sql, /for delete[\s\S]{0,200}using\s*\(\s*true\s*\)/i);
assert.doesNotMatch(sql, /for insert[\s\S]{0,200}with check[\s\S]{0,100}auth\.role/i);

const rpc = sql.match(
  /create or replace function public\.replace_ameen_item_snapshot\([\s\S]*?p_expected_sales_generation jsonb[\s\S]*?\$\$;/i,
)?.[0];
assert.ok(rpc, 'snapshot replacement RPC must exist');
assert.match(rpc, /\bsecurity invoker\b/i);
assert.doesNotMatch(rpc, /\bsecurity definer\b/i);
assert.match(rpc, /if not \(select public\.ameen_item_snapshot_is_sync_writer\(\)\) then[\s\S]*raise exception 'sync writer required'/i);
assert.match(
  rpc,
  /select count\s*\(\s*distinct s\.generated_at\s*\)\s*from pg_temp\.staged_ameen_item_snapshot s/i,
);
assert.doesNotMatch(rpc, /count\s*\(\s*distinct generated_at\s*\)/i);
assert.match(rpc, /where nullif\s*\(\s*btrim\s*\(\s*s\.item_key\s*\)/i);
assert.match(
  rpc,
  /select s\.item_key\s*from pg_temp\.staged_ameen_item_snapshot s\s*group by s\.item_key/i,
);
assert.match(rpc, /where s\.units_sold_30d < 0/i);
assert.match(sql, /drop function if exists public\.replace_ameen_item_snapshot\(jsonb\);/i);
assert.match(rpc, /p_snapshot_window_start date[\s\S]*p_snapshot_window_end date/i);
assert.match(rpc, /p_expected_sales_generation jsonb/i);
assert.match(rpc, /pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\(\s*'public\.sales_line_items\.atomic_refresh'/i);
assert.match(rpc, /from public\.sales_line_items_sync_state s[\s\S]*where s\.source = 'ameen_sales_line_items'/i);
assert.match(rpc, /sales generation changed before snapshot publication/i);
assert.match(rpc, /trusted sales marker does not cover the full snapshot window/i);
assert.match(rpc, /interval '75 minutes'/i);
assert.match(rpc, /count\(\*\)::integer, count\(s\.source_key\)::integer,[\s\S]*count\(distinct s\.source_key\)::integer/i);
assert.match(rpc, /trusted sales row_count no longer matches the full snapshot window/i);
assert.doesNotMatch(rpc, /delete from public\.ameen_item_snapshot\s*;/i);
assert.match(
  rpc,
  /delete from public\.ameen_item_snapshot s\s*where s\.item_key is not null\s*;/i,
);
assert.doesNotMatch(rpc, /delete from public\.ameen_item_snapshot[\s\S]{0,100}where\s+(?:true|1\s*=\s*1)/i);

const stagedInsert = rpc.match(
  /insert into public\.ameen_item_snapshot[\s\S]*?\)\s*select[\s\S]*?from pg_temp\.staged_ameen_item_snapshot s;/i,
)?.[0];
assert.ok(stagedInsert, 'RPC insert must use an explicit staging alias');
for (const field of [
  'id',
  'item_key',
  'item_guid',
  'item_number',
  'item_name',
  'unit1_name',
  'unit2_name',
  'unit2_factor',
  'stock_unit1',
  'stock_unit2',
  'last_purchase_price',
  'last_purchase_currency',
  'last_purchase_date',
  'last_purchase_unit',
  'average_cost',
  'average_cost_currency',
  'average_cost_basis',
  'last_supplier_name',
  'last_supplier_guid',
  'units_sold_30d',
  'movement_rank',
  'generated_at',
]) {
  assert.match(stagedInsert, new RegExp(`\\bs\\.${field}\\b`));
}
assert.doesNotMatch(sql, /\bsecurity definer\b/i);
assert.doesNotMatch(sql, /grant execute[^;]*to (?:public|anon|service_role)/i);
assert.match(sql, /grant execute on function public\.replace_ameen_item_snapshot\(jsonb, date, date, jsonb\)[\s\S]*?to authenticated;/i);
assert.match(sql, /revoke all on function public\.replace_ameen_item_snapshot\(jsonb, date, date, jsonb\)[\s\S]*?from public, anon, service_role;/i);
assert.doesNotMatch(sql, /grant execute on function public\.replace_ameen_item_snapshot\(jsonb\)\s/i);

// Authorization matrix implied by the fixed-UID helper and RLS policies.
const normalAuthenticatedUid = '00000000-0000-4000-8000-000000000001';
const canSelect = (role) => role === 'authenticated';
const isSyncWriter = (role, uid) => role === 'authenticated' && uid === syncUid;
const permissionsFor = (role, uid) => ({
  select: canSelect(role),
  insert: isSyncWriter(role, uid),
  delete: isSyncWriter(role, uid),
  rpc: isSyncWriter(role, uid),
});
assert.deepEqual(permissionsFor('authenticated', normalAuthenticatedUid), {
  select: true, insert: false, delete: false, rpc: false,
});
assert.deepEqual(permissionsFor('authenticated', syncUid), {
  select: true, insert: true, delete: true, rpc: true,
});
assert.deepEqual(permissionsFor('anon', null), {
  select: false, insert: false, delete: false, rpc: false,
});

console.log('Item snapshot SQL security contract checks passed.');
