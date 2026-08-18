# Hardened sales line items pipeline

This change is registration and migration source only. Applying the SQL,
registering the task, and running the producer are separate production steps.

## Baseline inspected on 2026-08-18

`public.sales_line_items` has a bigint sequence-backed `id` primary key and no
business/source unique key. Its columns are `id`, `bill_no`, `bill_type`,
`sale_date`, `item_key`, `item_name`, `qty`, `unit_price`, `line_total`,
`unit_cost`, `net_profit`, `customer_name`, `created_at`, `unit2_name`, and
`unit2_factor`. The existing indexes cover the primary key, `sale_date desc`,
and `item_name`.

RLS is enabled, but the current INSERT and DELETE policies accept every
authenticated user through an `auth.role()` check. Supabase grants also expose
all table privileges to `anon`, `authenticated`, and `service_role`; RLS happens
to block anonymous rows, while any normal authenticated account can currently
replace data. The migration removes direct anonymous access and narrows
authenticated writes to the established fixed sync identity.

Project consumers are:

- `scripts/refresh-ameen-item-snapshot.mjs`, which reads a 30-day movement window;
- `supabase/functions/telegram-webhook/index.ts`, for system freshness, item
  movement, and today's carton sales;
- `supabase/telegram-notifications.sql`, for evening sales/carton totals.

The current producer reads one inclusive seven-day Ameen window (today through
today minus seven days) with a streaming SQL reader, then DELETEs that Supabase
window and POSTs rows in batches of 500. It has no pagination after the Ameen
reader, no stable source-row key, and relies on delete/reinsert for duplicate
avoidance. It accepts only the three established sales type GUIDs and maps them
to `retail` or `wholesale`; signed negative quantities are preserved, while
separate BillType 3 return invoices are outside this pipeline's existing scope.
`created_at` is currently assigned independently by Supabase during each batch.
If batch N fails, the old window is already gone and only earlier batches remain.

## Atomic source contract

`public.replace_sales_line_items_window(date, date, jsonb)` runs as
`SECURITY INVOKER`. It serializes concurrent replacements, stages the complete
payload, validates required fields/window/type/source-key uniqueness, and only
then deletes and inserts the requested window. PostgreSQL commits the row
replacement and its completion marker together, so a failure before commit
leaves the prior window and prior marker intact.

Each Ameen `bi000.GUID` becomes `source_key`. A partial unique index rejects a
duplicate source line without changing legacy rows outside the replacement
window. Negative quantities remain valid by design. Unsupported values outside
`retail` and `wholesale` fail closed.

`public.sales_line_items_sync_state` is a singleton completion contract for
`ameen_sales_line_items`. A consumer can read `sync_run_id`, `window_start`,
`window_end`, `row_count`, and `completed_at`, then require a sufficiently fresh
completion whose window covers its query. Because the marker and rows commit in
the same transaction, there is no observable rebuilding state. The future item
snapshot freshness guard is intentionally not added in this change.

## Scheduled task audit and future registration

The live `TOBACCO Sales Line Items Push` task was audited read-only and was not
changed. At inspection it was Ready, enabled, `LOQ`/Interactive/Highest,
30-minute repetition, `PT5M`, `IgnoreNew`, restart 2 times at `PT1M`,
`StartWhenAvailable=False`, and both battery stop/start restrictions enabled.
Its action used `powershell.exe` without a working directory.

The registration source now defines `OZK2026\LOQ` with Password logon, a secure
registration-time credential prompt, the full Windows PowerShell 5.1 path,
repository working directory, battery-safe settings, `StartWhenAvailable`,
`IgnoreNew`, a 15-minute execution limit, and the existing restart contract.
It registers/replaces the definition but never calls `Start-ScheduledTask`; the
first trigger is one full interval after registration.
