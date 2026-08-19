import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [snapshotSql, salesSql, producer] = await Promise.all([
  readFile('supabase/ameen-item-snapshot-refresh.sql', 'utf8'),
  readFile('supabase/sales-line-items-atomic-refresh.sql', 'utf8'),
  readFile('scripts/refresh-ameen-item-snapshot.mjs', 'utf8'),
]);
const rpc = snapshotSql.match(
  /create or replace function public\.replace_ameen_item_snapshot\([\s\S]*?p_expected_sales_generation jsonb[\s\S]*?\$\$;/i,
)?.[0];
assert.ok(rpc, 'generation-guarded snapshot RPC must exist');

const lockContract = /pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\(\s*'public\.sales_line_items\.atomic_refresh'\s*,\s*0\s*\)\s*\)/i;
assert.match(salesSql, lockContract, 'Sales replacement must retain the shared advisory-lock contract');
assert.match(rpc, lockContract, 'Snapshot publication must use the same advisory-lock contract');

const lockIndex = rpc.search(lockContract);
const markerReadIndex = rpc.search(/from public\.sales_line_items_sync_state/i);
const generationCheckIndex = rpc.search(/sales generation changed before snapshot publication/i);
const actualRowsIndex = rpc.search(/from public\.sales_line_items s/i);
const deleteIndex = rpc.search(/delete from public\.ameen_item_snapshot/i);
assert.ok(lockIndex >= 0 && lockIndex < markerReadIndex, 'lock must precede the transactional marker read');
assert.ok(markerReadIndex < generationCheckIndex, 'current marker must be read before generation comparison');
assert.ok(generationCheckIndex < actualRowsIndex, 'generation must match before full-window row validation');
assert.ok(actualRowsIndex < deleteIndex, 'all Sales checks must complete before Snapshot publication');
assert.match(snapshotSql, /drop function if exists public\.replace_ameen_item_snapshot\(jsonb\);/i);
assert.doesNotMatch(snapshotSql, /grant execute on function public\.replace_ameen_item_snapshot\(jsonb\)\s/i);
for (const field of ['source', 'sync_run_id', 'window_start', 'window_end', 'row_count', 'completed_at']) {
  assert.match(
    rpc,
    new RegExp(`v_current_${field}\\s+is distinct from\\s+v_expected_${field}`, 'i'),
    `transactional RPC must compare expected ${field}`,
  );
}

for (const parameter of [
  'p_snapshot_window_start',
  'p_snapshot_window_end',
  'p_expected_sales_generation',
  'sync_run_id',
  'window_start',
  'window_end',
  'row_count',
  'completed_at',
]) {
  assert.ok(producer.includes(parameter), `producer must pass ${parameter}`);
}

const baseGeneration = {
  source: 'ameen_sales_line_items',
  sync_run_id: 'afc6e476-01d6-4332-88d9-b2cfe6fcdb23',
  window_start: '2026-07-20',
  window_end: '2026-08-19',
  row_count: 3,
  completed_at: '2026-08-19T00:45:00.000Z',
};
const sameGeneration = (left, right) => Object.keys(baseGeneration)
  .every((field) => left[field] === right[field]);
function simulateTransactionalPublication({ expected, current, actualSalesCount = 3,
  actualSourceKeyCount = 3, snapshotBefore = ['old'], snapshotAfter = ['new'] }) {
  // This models the SQL ordering asserted above: acquire the shared lock, then
  // compare/count, and only then replace the Snapshot table.
  if (!sameGeneration(expected, current)) throw new Error('sales generation changed before snapshot publication');
  if (current.window_start !== '2026-07-20' || current.window_end !== '2026-08-19') {
    throw new Error('trusted sales marker does not cover the full snapshot window');
  }
  if (actualSalesCount !== current.row_count || actualSourceKeyCount !== actualSalesCount) {
    throw new Error('trusted sales rows do not match the marker');
  }
  return snapshotAfter;
}

// 1. A == B and the locked current generation still matches: publication is allowed.
assert.deepEqual(simulateTransactionalPublication({
  expected: baseGeneration, current: { ...baseGeneration },
}), ['new']);

// 3/4. A generation committed after marker B: the RPC fails before publication.
const snapshotBefore = ['old'];
assert.throws(() => simulateTransactionalPublication({
  expected: baseGeneration,
  current: { ...baseGeneration, sync_run_id: '00000000-0000-4000-8000-000000000099' },
  snapshotBefore,
}), /sales generation changed/);
assert.deepEqual(snapshotBefore, ['old']);

// 5. Matching UUID with changed metadata is also fail-closed.
assert.throws(() => simulateTransactionalPublication({
  expected: baseGeneration,
  current: { ...baseGeneration, row_count: 4 },
}), /sales generation changed/);

// 14. Full-window rows are rechecked under the lock before the Snapshot delete.
assert.throws(() => simulateTransactionalPublication({
  expected: baseGeneration, current: { ...baseGeneration }, actualSalesCount: 2,
}), /trusted sales rows do not match/);

console.log('Item snapshot post-marker-B generation race contract checks passed.');
