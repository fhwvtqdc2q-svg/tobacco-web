import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SALES_SYNC_MAX_AGE_MINUTES,
  assertTrustedSalesInput,
  getSingleSalesSyncMarker,
} from './item-snapshot-freshness.mjs';

const now = new Date('2026-08-19T01:10:00.000Z');
const snapshotWindow = { start: '2026-07-20', end: '2026-08-19' };
const marker = {
  source: 'ameen_sales_line_items',
  sync_run_id: 'afc6e476-01d6-4332-88d9-b2cfe6fcdb23',
  window_start: '2026-08-12',
  window_end: '2026-08-19',
  row_count: 2,
  completed_at: '2026-08-19T00:45:00.000Z',
};
const salesRows = [
  { sale_date: '2026-07-25', source_key: null },
  { sale_date: '2026-08-12', source_key: '00000000-0000-4000-8000-000000000001' },
  { sale_date: '2026-08-19', source_key: '00000000-0000-4000-8000-000000000002' },
];

// A. A fresh, complete marker permits an applyable input set.
const trusted = assertTrustedSalesInput({
  markerBefore: marker, markerAfter: { ...marker }, salesLineItems: salesRows,
  snapshotWindow, now,
});
assert.equal(trusted.rowCount, 2);
assert.equal(SALES_SYNC_MAX_AGE_MINUTES, 75);
assert.throws(() => assertTrustedSalesInput({
  markerBefore: { ...marker, source: 'wrong_source' },
  markerAfter: { ...marker, source: 'wrong_source' },
  salesLineItems: salesRows, snapshotWindow, now,
}), /unexpected marker source/);
assert.throws(() => assertTrustedSalesInput({
  markerBefore: { ...marker, sync_run_id: 'not-a-uuid' },
  markerAfter: { ...marker, sync_run_id: 'not-a-uuid' },
  salesLineItems: salesRows, snapshotWindow, now,
}), /sync_run_id is not a valid UUID/);
assert.throws(() => assertTrustedSalesInput({
  markerBefore: { ...marker, completed_at: null },
  markerAfter: { ...marker, completed_at: null },
  salesLineItems: salesRows, snapshotWindow, now,
}), /completed_at is missing or invalid/);
assert.throws(() => assertTrustedSalesInput({
  markerBefore: { ...marker, row_count: -1 }, markerAfter: { ...marker, row_count: -1 },
  salesLineItems: salesRows, snapshotWindow, now,
}), /row_count must be a non-negative integer/);

// B. Missing marker is fail-closed.
assert.throws(() => getSingleSalesSyncMarker([]), /completion marker is missing/);

// C. Two missed 30-minute cycles plus the 15-minute execution margin is stale.
assert.throws(() => assertTrustedSalesInput({
  markerBefore: { ...marker, completed_at: '2026-08-18T23:54:59.000Z' },
  markerAfter: { ...marker, completed_at: '2026-08-18T23:54:59.000Z' },
  salesLineItems: salesRows, snapshotWindow, now,
}), /completion marker is stale/);

// D. The marker must cover the mutable D-7..D tail and share the consumer end date.
assert.throws(() => assertTrustedSalesInput({
  markerBefore: { ...marker, window_start: '2026-08-13' },
  markerAfter: { ...marker, window_start: '2026-08-13' },
  salesLineItems: salesRows, snapshotWindow, now,
}), /does not cover the required 7-day mutable tail/);
assert.throws(() => assertTrustedSalesInput({
  markerBefore: { ...marker, window_end: '2026-08-18' },
  markerAfter: { ...marker, window_end: '2026-08-18' },
  salesLineItems: salesRows, snapshotWindow, now,
}), /does not match snapshot window_end/);

// E. The committed marker count must match actual rows in the marker window.
assert.throws(() => assertTrustedSalesInput({
  markerBefore: { ...marker, row_count: 3 }, markerAfter: { ...marker, row_count: 3 },
  salesLineItems: salesRows, snapshotWindow, now,
}), /marker row_count is 3, but 2 rows were read/);

// F. A sales commit during pagination changes sync_run_id and blocks the snapshot.
assert.throws(() => assertTrustedSalesInput({
  markerBefore: marker,
  markerAfter: { ...marker, sync_run_id: '00000000-0000-4000-8000-000000000099' },
  salesLineItems: salesRows, snapshotWindow, now,
}), /completion marker changed during sales reads/);

// G. Dry-run and Apply share the same guard, before either branch can report output/write.
const producer = await readFile('scripts/refresh-ameen-item-snapshot.mjs', 'utf8');
const guardIndex = producer.indexOf('const trustedSalesSync = assertTrustedSalesInput');
const dryRunIndex = producer.indexOf('if (!apply)');
const rpcIndex = producer.indexOf('/rest/v1/rpc/replace_ameen_item_snapshot');
assert.ok(guardIndex >= 0 && guardIndex < dryRunIndex, 'freshness guard must run before Dry Run returns');
assert.ok(guardIndex < rpcIndex, 'freshness guard must run before the snapshot RPC');
assert.doesNotMatch(producer, /max\s*\(\s*created_at\s*\)/i);

console.log('Item snapshot freshness guard contract checks passed.');
