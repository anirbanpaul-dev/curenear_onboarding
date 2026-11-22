# Performance

Generated 2026-11-22T09:21:51.012Z by `scripts/load/provider-load.ts`.

## Workload

- **Dataset:** 100,000 synthetic providers (`pnpm seed:synthetic-providers -- --count=100000`).
- **Tool:** autocannon, 20 connections for 15 seconds per scenario.
- **Target:** http://localhost:3000
- **Authentication:** administrator session (cookie), the same path the portal uses.
- **Rows present:** 100,000 synthetic provider organizations. Documents and
  licences are skipped (`--skip-documents`) because the seed's per-row
  document-gap trigger makes that stage dominate runtime; directory and PIN
  queries do not depend on them.

## Results

| Scenario | Throughput (req/s) | p50 | p97.5 | p99 | max | Non-2xx | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Provider directory (50 rows) | 50.94 | 325 ms | 1751 ms | 1802 ms | 1815 ms | 0 | PASS |
| Provider directory (search) | 7.8 | 2466 ms | 3206 ms | 3276 ms | 3319 ms | 0 | PASS |
| PIN summary (read model) | 54.74 | 287 ms | 500 ms | 3090 ms | 3108 ms | 0 | PASS |
| PIN summary (live aggregation) | 5.87 | 3026 ms | 4299 ms | 4411 ms | 4411 ms | 0 | PASS |

## Acceptance target

The storage acceptance target for this dataset is **p97.5 ≤ 300 ms** for the
provider directory. This run misses that target (1,751 ms p97.5) because it used
the Next.js dev server on a Windows host while PostgreSQL, the load generator
and the app shared one machine. It is a regression baseline, not a release
sign-off; the CI `performance` job records the same numbers from a clean Linux
runner for comparison.

## Caveats

- Synthetic rows have no realistic type_data or document spread; they exercise indexes and joins, not content rendering.
- Numbers include the Next.js dev server unless the run used a production build. Use `pnpm build && pnpm --filter @curenear/web start` for release figures.
- The load generator, database and app shared one machine. Treat these as regression baselines, not absolute capacity.
- Non-2xx counts include any 401/403 caused by a bad cookie; a PASS requires zero errors and zero non-2xx.
