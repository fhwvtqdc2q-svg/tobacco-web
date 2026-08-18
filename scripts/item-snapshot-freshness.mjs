export const SALES_SYNC_SOURCE = 'ameen_sales_line_items';
export const SALES_SYNC_CADENCE_MINUTES = 30;
// Two missed 30-minute cadences plus the task's 15-minute execution/jitter budget.
export const SALES_SYNC_MAX_AGE_MINUTES = 75;
export const SALES_SYNC_TRUSTED_TAIL_DAYS = 7;
const MAX_FUTURE_SKEW_MINUTES = 5;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(reason) {
  throw new Error(`sales freshness guard failed: ${reason}`);
}

function dateOnly(value, label) {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    fail(`${label} is not a valid date`);
  }
  return text;
}

function subtractDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function getSingleSalesSyncMarker(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    fail(rows?.length ? `expected one ${SALES_SYNC_SOURCE} marker, received ${rows.length}` : 'completion marker is missing');
  }
  return rows[0];
}

export function validateSalesSyncMarker(marker, snapshotWindow, {
  now = new Date(),
  maxAgeMinutes = SALES_SYNC_MAX_AGE_MINUTES,
  trustedTailDays = SALES_SYNC_TRUSTED_TAIL_DAYS,
} = {}) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) fail('completion marker is missing');
  if (marker.source !== SALES_SYNC_SOURCE) fail(`unexpected marker source: ${marker.source ?? '<missing>'}`);
  if (!UUID_PATTERN.test(String(marker.sync_run_id ?? ''))) fail('sync_run_id is not a valid UUID');

  const completedAtText = String(marker.completed_at ?? '').trim();
  if (!completedAtText) fail('completed_at is missing or invalid');
  const completedAt = new Date(completedAtText);
  const checkedAt = new Date(now);
  if (!Number.isFinite(completedAt.getTime())) fail('completed_at is missing or invalid');
  if (!Number.isFinite(checkedAt.getTime())) fail('guard clock is invalid');
  const ageMs = checkedAt.getTime() - completedAt.getTime();
  if (ageMs < -(MAX_FUTURE_SKEW_MINUTES * 60_000)) fail('completed_at is unexpectedly in the future');
  if (ageMs > maxAgeMinutes * 60_000) {
    fail(`completion marker is stale (${Math.floor(ageMs / 60_000)} minutes old; maximum ${maxAgeMinutes})`);
  }

  const rowCount = Number(marker.row_count);
  if (!Number.isInteger(rowCount) || rowCount < 0) fail('row_count must be a non-negative integer');
  const markerStart = dateOnly(marker.window_start, 'marker.window_start');
  const markerEnd = dateOnly(marker.window_end, 'marker.window_end');
  if (markerEnd < markerStart) fail('marker window is inverted');

  const snapshotStart = dateOnly(snapshotWindow?.start, 'snapshot.window_start');
  const snapshotEnd = dateOnly(snapshotWindow?.end, 'snapshot.window_end');
  if (snapshotEnd < snapshotStart) fail('snapshot window is inverted');
  const requiredTailStart = subtractDays(snapshotEnd, trustedTailDays);
  if (markerEnd !== snapshotEnd) {
    fail(`marker window_end ${markerEnd} does not match snapshot window_end ${snapshotEnd}`);
  }
  if (markerStart > requiredTailStart) {
    fail(`marker window does not cover the required ${trustedTailDays}-day mutable tail starting ${requiredTailStart}`);
  }
  if (markerStart < snapshotStart) {
    fail(`marker window_start ${markerStart} is outside snapshot window_start ${snapshotStart}`);
  }

  return {
    source: marker.source,
    syncRunId: String(marker.sync_run_id).toLowerCase(),
    windowStart: markerStart,
    windowEnd: markerEnd,
    rowCount,
    completedAt: completedAt.toISOString(),
  };
}

export function validateSalesRowsAgainstMarker(salesLineItems, marker) {
  if (!Array.isArray(salesLineItems)) fail('sales rows are unavailable');
  const markerRows = salesLineItems.filter((row) => {
    const saleDate = dateOnly(row.sale_date, 'sales_line_items.sale_date');
    return saleDate >= marker.windowStart && saleDate <= marker.windowEnd;
  });
  if (markerRows.length !== marker.rowCount) {
    fail(`marker row_count is ${marker.rowCount}, but ${markerRows.length} rows were read from its window`);
  }

  const sourceKeys = new Set();
  for (const row of markerRows) {
    const sourceKey = String(row.source_key ?? '').trim().toLowerCase();
    if (!UUID_PATTERN.test(sourceKey)) fail('marker-window row has a missing or invalid source_key');
    if (sourceKeys.has(sourceKey)) fail(`duplicate source_key in marker window: ${sourceKey}`);
    sourceKeys.add(sourceKey);
  }
  return markerRows.length;
}

export function assertStableSalesSync(before, after) {
  for (const field of ['source', 'syncRunId', 'windowStart', 'windowEnd', 'rowCount', 'completedAt']) {
    if (before[field] !== after[field]) fail(`completion marker changed during sales reads (${field})`);
  }
}

export function assertTrustedSalesInput({ markerBefore, markerAfter, salesLineItems,
  snapshotWindow, now = new Date() }) {
  const before = validateSalesSyncMarker(markerBefore, snapshotWindow, { now });
  validateSalesRowsAgainstMarker(salesLineItems, before);
  const after = validateSalesSyncMarker(markerAfter, snapshotWindow, { now });
  assertStableSalesSync(before, after);
  return before;
}
