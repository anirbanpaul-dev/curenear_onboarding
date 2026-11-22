# Testing

## Layers

| Layer | Command | Where |
| --- | --- | --- |
| Shared unit + coverage gate | `pnpm --filter @curenear/shared test:coverage` | `packages/shared/src/**/*.test.ts` |
| Web unit + service coverage | `pnpm --filter @curenear/web test:coverage` | `apps/web/src/**/*.test.ts` |
| Integration, OpenAPI contract, Testcontainers | `pnpm test:int` | `apps/web/tests/integration`, `packages/db/tests` |
| Critical journeys, exports, axe | `pnpm e2e` | `apps/web/e2e` |
| 100k-provider load test | `pnpm perf:seed && pnpm perf:load` | `scripts/load/provider-load.ts` |

`packages/shared` enforces 80% lines, statements, functions and branches. The web
service layer is reported with a ratchet (14% lines/statements, 60% functions,
70% branches) because the large onboarding and review services do not have unit
suites yet; the ratchet must only move up. Export, analytics, notification and
staff services are covered, and auth has partial coverage.

`apps/web/tests/integration/testcontainers.test.ts` starts real PostgreSQL and
MinIO containers and is skipped, not silently passed, when Docker is absent.
The OpenAPI document lives in `docs/openapi.json`; contract tests inline its
`$ref`s and validate live handler responses.

## Local constraints

- Docker is not available on every developer machine. Testcontainers and the
  export browser test are therefore validated in CI; locally they either skip
  or are gated behind `E2E_EXPORTS=1`.
- The export E2E path needs MinIO and the worker. CI starts both.
- `pnpm e2e` uses a dev server by default; start one with `pnpm dev:web` or let
  Playwright's `webServer` do it.

## CI

`.github/workflows/ci.yml` runs lint, typecheck, coverage, integration/contract/
Testcontainers and build in `quality`; the `e2e` job runs the critical journeys,
export download and axe scans against PostgreSQL and MinIO and uploads the HTML/
JUnit Playwright report plus coverage. The `performance` job (main pushes and
manual dispatch) seeds 100,000 synthetic providers, runs autocannon and uploads
`docs/performance.md`.
