import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildItemSnapshot, getSalesWindow, parseQuantity } from './item-snapshot-pipeline.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedAt = '2026-08-17T02:05:00.000Z';
const baseRow = (key, name = key) => ({
  id: `00000000-0000-4000-8000-${key.padStart(12, '0').slice(-12)}`,
  item_key: key, item_guid: key, item_name: name, units_sold_30d: 0,
  movement_rank: 1, generated_at: '2026-08-07T04:05:10.637Z',
});
const sale = (key, qty, saleDate = '2026-08-17', billType = 'retail') => ({
  item_key: key, item_name: key, qty, sale_date: saleDate, bill_type: billType,
  unit2_name: 'box', unit2_factor: 10,
});
const build = (overrides = {}) => buildItemSnapshot({
  currentSnapshot: [baseRow('1'), baseRow('2')], itemCosts: [], salesLineItems: [],
  windowEnd: '2026-08-17', generatedAt, ...overrides,
});

assert.deepEqual(getSalesWindow('2026-08-17', 30), { start: '2026-07-18', end: '2026-08-17' });
assert.equal(parseQuantity('1.125'), 1125n);
assert.equal(parseQuantity('-0.5'), -500n);
assert.throws(() => parseQuantity('1.0001'), /three decimal/);

const aggregation = build({ salesLineItems: [
  sale('1', '1', '2026-07-18'), sale('1', '2.5'), sale('1', '2.5'),
  sale('1', '99', '2026-07-17'), sale('2', '8', '2026-08-17', 'wholesale'),
] });
assert.equal(aggregation.rows.find((row) => row.item_key === '1').units_sold_30d, 6);
assert.equal(aggregation.rows.find((row) => row.item_key === '2').units_sold_30d, 8);
assert.equal(aggregation.rows.find((row) => row.item_key === '2').movement_rank, 1);
assert.equal(aggregation.rows.find((row) => row.item_key === '1').movement_rank, 2);

const returns = build({ salesLineItems: [sale('1', '10'), sale('1', '-3')] });
assert.equal(returns.rows.find((row) => row.item_key === '1').units_sold_30d, 7);
assert.throws(() => build({ salesLineItems: [sale('1', '1', '2026-08-17', 'return')] }), /unsupported bill_type/);
assert.throws(() => build({ salesLineItems: [sale('1', '-1')] }), /negative 30-day net/);

const emptySales = build();
assert.equal(emptySales.rows.length, 2);
assert.ok(emptySales.rows.every((row) => row.units_sold_30d === 0));
assert.ok(emptySales.rows.every((row) => row.movement_rank === 1));
assert.deepEqual(new Set(emptySales.rows.map((row) => row.generated_at)), new Set([generatedAt]));

const newItem = build({
  itemCosts: [{ item_guid: '3', item_name: 'new item', avg_cost: 4, currency: 'USD', updated_at: generatedAt }],
  salesLineItems: [sale('3', '2')],
});
assert.equal(newItem.rows.length, 3);
assert.equal(newItem.rows.find((row) => row.item_key === '3').average_cost, 4);
assert.equal(new Set(newItem.rows.map((row) => row.item_key)).size, newItem.rows.length);
assert.throws(() => build({ currentSnapshot: [baseRow('1'), baseRow('1')] }), /duplicate current snapshot/);

const [wrapper, producer, registration, sql] = await Promise.all([
  readFile(path.join(repoRoot, 'tools', 'push-purchase-item-snapshot.ps1'), 'utf8'),
  readFile(path.join(repoRoot, 'scripts', 'refresh-ameen-item-snapshot.mjs'), 'utf8'),
  readFile(path.join(repoRoot, 'tools', 'register-purchase-item-snapshot-task.ps1'), 'utf8'),
  readFile(path.join(repoRoot, 'supabase', 'ameen-item-snapshot-refresh.sql'), 'utf8'),
]);
for (const source of [wrapper, producer]) {
  assert.doesNotMatch(source, /AMEEN_SQL_CONNECTION_STRING|SqlConnection|System\.Data\.SqlClient|\bdbo\./i);
  assert.doesNotMatch(source, /service[_-]?role/i);
}
assert.match(wrapper, /\[switch\]\$Apply/);
assert.match(producer, /if \(!apply\)/);
assert.match(registration, /New-ScheduledTaskTrigger -Daily/);
assert.match(registration, /05:05/);
assert.match(registration, /MultipleInstances IgnoreNew/);
assert.doesNotMatch(registration, /Start-ScheduledTask/);
assert.match(sql, /security invoker/i);
assert.match(sql, /create temporary table[\s\S]+delete from public\.ameen_item_snapshot[\s\S]+insert into public\.ameen_item_snapshot/i);

console.log('Item snapshot pipeline contract checks passed.');
