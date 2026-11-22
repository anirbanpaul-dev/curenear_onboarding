# Repository inventory

Verified from the working tree on 2026-11-22. Commands and variables below were found in
`package.json` files, `packages/shared/src/env.ts`, `docker-compose.yml`, the worker source and
the API routes. Anything not verified is marked.

## Applications and packages

| Path | Package | What it does |
| --- | --- | --- |
| `apps/web` | `@curenear/web` | Next.js 15 App Router UI and all `/api/*` and `/api/v1/*` route handlers. Runs the portal, review workflow, admin directory, analytics, documents, exports and health probes. |
| `apps/worker` | `@curenear/worker` | Long-running pg-boss worker. Dispatches `outbox_events`, runs scheduled jobs, sends email, delivers webhooks and creates CSV exports. No HTTP port. |
| `packages/db` | `@curenear/db` | Prisma schema, 20 migrations, Prisma client factory, repositories, transactions, audit/outbox helpers, seed and PIN import. |
| `packages/shared` | `@curenear/shared` | Zod schemas, field registry, enums, provider lifecycle, RBAC/policy, errors, environment validation and utilities. |
| `packages/config` | `@curenear/config` | Shared TypeScript presets and the ESLint flat-config factory; tests parse the CI and deployment YAML. |

Layering is route handler → service → repository. Prisma is used only in `packages/db`.
The web app and worker both import `@curenear/shared` and `@curenear/db` as TypeScript workspace
packages; there is no separate package build step.

## Versions

| Tool | Required | Source |
| --- | --- | --- |
| Node.js | 22.x (engine `>=22 <23`, `.nvmrc` = `22`) | root `package.json`, `.nvmrc` |
| pnpm | 9.15.9 through Corepack | root `packageManager` |
| Next.js | `^15.1.6`, resolved to 15.5.28 in the installed tree | `apps/web/package.json` |
| React | 19 | `apps/web/package.json` |
| Prisma | `^6.2.1` | `packages/db/package.json` |
| PostgreSQL | 16 in compose/CI; a local PostgreSQL 18.4 instance was also used during development | `docker-compose.yml`, CI, `README.md` |
| Docker | Docker Engine/Desktop with Compose v2 for local services and images | `docker-compose.yml` |

Corepack is available with Node 22. `corepack enable` is required once per machine.

## Scripts

Run all commands from the repository root unless stated.

### Root

| Script | What it does |
| --- | --- |
| `pnpm dev` | Web (`next dev`, port 3000) and worker (`tsx watch`) in parallel. |
| `pnpm dev:web` | Web dev server only. |
| `pnpm dev:worker` | Worker only. |
| `pnpm build` | Typecheck shared and db, `next build`, then typecheck the worker. |
| `pnpm lint` / `pnpm lint:fix` | ESLint across the monorepo. |
| `pnpm format` / `pnpm format:check` | Prettier write / check. |
| `pnpm typecheck` | `tsc --noEmit` in every workspace. |
| `pnpm test` | Vitest unit suites in every workspace. |
| `pnpm test:coverage` | Shared (80% gate) and web service coverage. |
| `pnpm test:int` | db, web and worker integration suites; needs a migrated `TEST_DATABASE_URL`. Testcontainers tests skip when Docker is absent. |
| `pnpm e2e` | Playwright from `apps/web`; needs a running app and seeded fixtures. |
| `pnpm db:generate` | Prisma client generation. |
| `pnpm db:migrate` | `prisma migrate deploy`. |
| `pnpm db:seed` | Idempotent first ADMIN plus reference data. |
| `pnpm db:reset` | `prisma migrate reset --force`; destructive, local only. |
| `pnpm db:rebuild-stats` | Rebuild the PIN analytics read model. |
| `pnpm db:backfill-review` | Backfill review verification rows. |
| `pnpm import:pincodes <csv>` | Import the official India Post PIN directory. |
| `pnpm seed:synthetic-providers -- --count=100000 [--skip-documents] [--clean]` | Synthetic directory/performance data; refuses to run in production. |
| `pnpm perf:seed` | 100,000 synthetic providers without document rows. |
| `pnpm perf:load` | Autocannon load test; writes `docs/performance.md`. |
| `pnpm check:fields` | Compare the field registry with the spec. |
| `pnpm check:env [-- <file>] [--seed]` | Validate an env file without starting the app. |
| `pnpm prepare` | Installs Husky hooks. |

### `apps/web`

| Script | What it does |
| --- | --- |
| `dev` | `next dev -p 3000`. |
| `build` / `start` | Production build / start. |
| `typecheck` | `tsc --noEmit`. |
| `test`, `test:coverage` | Vitest unit tests, optionally with v8 coverage of `src/server/services`. |
| `test:int` | All integration tests in `tests/integration`. |
| `test:containers` | Only the Testcontainers PostgreSQL/MinIO suite. |
| `e2e` | Playwright. |

### `apps/worker`

| Script | What it does |
| --- | --- |
| `dev` | `tsx watch src/index.ts`. |
| `start` | `tsx src/index.ts`. |
| `typecheck`, `test`, `test:int` | Typecheck, unit tests, integration tests. |

### `packages/db`

| Script | What it does |
| --- | --- |
| `generate` | `prisma generate`. |
| `migrate:deploy` / `migrate:reset` | Apply migrations / reset (destructive). |
| `seed` | `tsx seed.ts`. |
| `typecheck`, `test`, `test:int` | Typecheck and tests. |

### `packages/shared` and `packages/config`

`packages/shared`: `typecheck`, `test`, `test:coverage`.
`packages/config`: `test` (includes YAML parsing of CI and deploy manifests).

## Environment variables

`packages/shared/src/env.ts` validates these at web and worker startup. Optional variables may be
absent; empty strings are treated as absent for `SMTP_USER`, `SMTP_PASSWORD` and the aggregator
variables. `required` below means required by that validator, not merely used somewhere.

| Name | Used by | Required | Secret | Local example | Purpose |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | both | no (default `development`) | no | `development` | `development`, `test`, `production`; production enables HSTS. |
| `DATABASE_URL` | both, db, tests | yes | yes | `postgresql://curenear:curenear@localhost:5432/curenear?schema=public` | PostgreSQL connection string. |
| `APP_URL` | web | no (default `http://localhost:3000`) | no | `http://localhost:3000` | Public origin; cookie/HTTPS checks and links. |
| `SESSION_SECRET` | both | yes (32+ chars) | yes | `dev-session-secret-change-me-at-least-32-chars` | Validated and reserved; sessions are opaque hashed tokens, so it is currently unused. |
| `SESSION_COOKIE_NAME` | web | no (default `curenear_session`) | no | `curenear_session` | Session cookie name. |
| `LOG_LEVEL` | both | no (default `info`) | no | `info` | pino level. |
| `S3_ENDPOINT` | both | yes | no | `http://127.0.0.1:9000` | S3-compatible API endpoint. |
| `S3_REGION` | both | no (default `us-east-1`) | no | `us-east-1` | S3 region/signing region. |
| `S3_BUCKET` | both | yes | no | `curenear` | Private document and export bucket. |
| `S3_ACCESS_KEY_ID` | both | yes | yes | `minioadmin` | Storage access key. |
| `S3_SECRET_ACCESS_KEY` | both | yes | yes | `minioadmin` | Storage secret. |
| `S3_FORCE_PATH_STYLE` | both | no (default `true`) | no | `true` locally, `false` on AWS | Path-style addressing for MinIO. |
| `DOCUMENT_SCAN_ENABLED` | web | no (default `false`) | no | `false` | Selects the scanning hook; the ClamAV implementation is a stub. |
| `CLAMAV_HOST` | web | no (default `127.0.0.1`) | no | `127.0.0.1` | ClamAV host, unused while scanning is off. |
| `CLAMAV_PORT` | web | no (default `3310`) | no | `3310` | ClamAV port. |
| `SMTP_HOST` | both | yes | no | `127.0.0.1` | SMTP relay. |
| `SMTP_PORT` | both | yes | no | `1025` (Mailpit), `587` production | SMTP port; port 465 enables implicit TLS. |
| `SMTP_FROM` | both | yes | no | `no-reply@curenear.local` | Sender address. |
| `SMTP_USER` | both | no | yes | empty | SMTP username. |
| `SMTP_PASSWORD` | both | no | yes | empty | SMTP password. |
| `PUBLIC_CONFIRMATION_LINK_ENABLED` | web | no (default `false`) | no | `false` | Enables tokenised public confirmation links. |
| `OUTBOX_BATCH_SIZE` | worker | no (default 25) | no | `25` | Events claimed per dispatch. |
| `OUTBOX_POLL_INTERVAL_MS` | worker | no (default 10000) | no | `10000` | Additional outbox polling interval. |
| `OUTBOX_MAX_ATTEMPTS` | worker | no (default 5) | no | `5` | Attempts before dead-lettering. |
| `OUTBOX_RETENTION_DAYS` | worker | no (default 30) | no | `30` | Published-event cleanup horizon. |
| `DEAD_LETTER_RETENTION_DAYS` | worker | no (default 90) | no | `90` | Dead-letter retention. |
| `STALE_DRAFT_DAYS` | worker | no (default 7) | no | `7` | Draft age before a reminder. |
| `WEBHOOK_MAX_ATTEMPTS` | worker | no (default 8) | no | `8` | Outbound webhook retry budget. |
| `EXPORT_MAX_ROWS` | web, worker | no (default 50000) | no | `50000` | CSV row cap. |
| `EXPORT_RETENTION_HOURS` | worker | no (default 24) | no | `24` | Finished-export lifetime. |
| `EXPORT_JOBS_PER_RUN` | worker | no (default 5) | no | `5` | Exports processed per tick. |
| `AGGREGATOR_WEBHOOK_URL` | worker | no | no | empty | POST event envelopes here; empty logs instead. |
| `AGGREGATOR_WEBHOOK_TOKEN` | worker | no (16+ chars if set) | yes | empty | Bearer token for the aggregator. |
| `SEED_ADMIN_EMAIL` | seed only | seed only | no | `admin@curenear.in` | First admin email. |
| `SEED_ADMIN_NAME` | seed only | no (default Portal Admin) | no | `Portal Admin` | First admin display name. |
| `SEED_ADMIN_PASSWORD` | seed only | seed only, 12+ chars | yes | `change-this-dev-password` | One-time initial password; forces a change. |
| `TEST_DATABASE_URL` | tests | no | yes | local test URL | Integration database; falls back to `DATABASE_URL`. |
| `E2E_BASE_URL` | Playwright | no | no | `http://localhost:3000` | Target origin. |
| `E2E_NO_SERVER` | Playwright | no | no | unset | `1` disables Playwright's own dev server. |
| `E2E_EXPECT_READY` | Playwright | no | no | unset | `1` requires readiness in the probe test. |
| `E2E_EXPORTS` | Playwright | no | no | unset | `1` enables the MinIO/worker export journey. |
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` | Playwright | no | yes | e2e fixture values | Operator login for specs. |
| `WALKTHROUGH_BASE_URL`, `WALKTHROUGH_ADMIN_EMAIL`, `WALKTHROUGH_ADMIN_PASSWORD` | manual walkthrough | no | yes | local defaults in script | HTTP walkthrough target. |
| `LOAD_BASE_URL`, `LOAD_EMAIL`, `LOAD_PASSWORD`, `LOAD_CONNECTIONS`, `LOAD_DURATION`, `LOAD_PIN`, `LOAD_OUTPUT` | load script | no | sometimes | see script | Autocannon configuration. |
| `NEXT_OUTPUT_STANDALONE` | web build | no | no | `1` in Docker build | Enables Next standalone tracing on Linux. |
| `PORT`, `HOSTNAME` | Next runtime | no | no | `3000`, `0.0.0.0` | Bind address in containers/Render. |
| `APP_DOMAIN`, `ACME_EMAIL` | Caddy compose | compose only | no | `app.example.com` | TLS hostname and ACME contact. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | optional compose db | compose profile only | password yes | `curenear` | Bundled database credentials. |
| `INIT_CWD` | pnpm child scripts | automatic | no | set by pnpm | Resolves relative paths in helper scripts. |

`SESSION_TTL_HOURS` was present in the old compose/CI files but is **not read by application
code**; session lifetimes are implemented in `apps/web/src/server/session.ts`. It has been removed
from the current compose and CI files. Do not treat it as configuration.

## External services

| Service | Required | Used for | Local implementation |
| --- | --- | --- | --- |
| PostgreSQL | yes | All persistent data, sessions, audit, outbox, pg-boss schema. | `db` compose service, port 5432. |
| S3-compatible object storage | yes | Private document uploads/downloads and generated export files, using presigned URLs. | MinIO, port 9000, console 9001; `minio-init` creates the bucket. |
| SMTP | yes | Password-reset mail, notifications and stale-draft reminders. | Mailpit, SMTP 1025, UI 8025. |
| Consumer aggregator webhook | optional | Receives outbox event envelopes. | Disabled when `AGGREGATOR_WEBHOOK_URL` is empty; events are logged. |
| ClamAV | optional | Document malware scan hook. | Stub; disabling is the only working setting. |
| Redis | no | Not used. The rate limiter is in-process memory. | — |
| SMS/OTP provider | no | Not integrated. | — |
| Sentry/APM/metrics backend | no | Not integrated. | — |

## Background jobs and schedules

Both the web app and worker write `outbox_events`; the worker dispatches them and also schedules
pg-boss jobs. All timings below are the cron strings in `apps/worker/src/index.ts`; pg-boss
evaluates them against its configured timezone, so verify that timezone on the deployment host.

| Queue | Cron / trigger | Purpose |
| --- | --- | --- |
| `outbox-dispatch` | every minute, plus `OUTBOX_POLL_INTERVAL_MS` (default 10s) | Claim and publish outbox events with backoff/dead-lettering. |
| `webhook-deliveries-dispatch` | every minute | Deliver registered outbound webhooks. |
| `export-jobs` | every minute | Build queued CSV exports. |
| `document-expiry-scan` | `0 2 * * *` | Find expiring/expired documents and licences. |
| `pin-stats-consistency-check` | `15 2 * * *` | Compare PIN analytics read model with live counts; logs drift. |
| `session-prune` | `0 3 * * *` | Delete expired sessions. |
| `outbox-cleanup` | `30 3 * * *` | Remove published events past retention. |
| `export-cleanup` | `45 3 * * *` | Delete expired export objects and rows. |
| `stale-draft-reminders` | `0 4 * * *` | Email owners of stale drafts. |

Event handlers (`apps/worker/src/handlers/index.ts`): pin-stats, search-index, notifications,
outbound webhooks and the consumer aggregator. Handler execution is recorded in
`processed_event_handlers`; each job run is recorded in `job_runs`.

## Ports

| Process | Port | Notes |
| --- | --- | --- |
| Web | 3000 | `next dev` and `next start`; container sets `PORT=3000`. |
| Worker | none | No HTTP listener. |
| PostgreSQL | 5432 | Compose and CI. |
| MinIO API / console | 9000 / 9001 | Local only. |
| Mailpit SMTP / UI | 1025 / 8025 | Local only. |
| Caddy | 80 / 443 | `docker-compose.prod.yml` only. |

## Health endpoints

| Endpoint | Verified behaviour |
| --- | --- |
| `GET /api/health` | 200 liveness; touches no dependency. |
| `GET /api/ready` | 200 only when PostgreSQL `SELECT 1` and S3 `HeadBucket` succeed; otherwise 503 with per-check states. |
| `GET /api/v1/health` | Alias liveness route under v1. |
| Worker | No HTTP probe. Liveness is the JSON log `worker_started`; job history is in `job_runs`. |

Both web probes use the standard `{ data }` envelope and echo `x-request-id`. No authentication is
required.

## Features not implemented (verified)

See `docs/DEPLOYMENT_GUIDE.md` §15 for severity and action. Confirmed absent or incomplete:

- No inbound partner/integration API and no public API clients; outbound webhooks and the
  aggregator delivery exist.
- `docs/openapi.json` documents only a subset of routes and is not served by the app.
- No MFA, no SMS/OTP provider integration, no account self-registration.
- No completed malware scanner; `DOCUMENT_SCAN_ENABLED=true` selects a stub that refuses uploads.
- Rate limiting is per-process in-memory; no Redis/Postgres-backed limiter.
- No Sentry, OpenTelemetry, Prometheus metrics or alerting integration.
- No automated backup/restore schedule in the repository; only the wrapper scripts.
- No demo provider seed; `db:seed` creates one admin and reference data.
- No inbound API for the consumer app; only the portal's cookie-authenticated API.
- `SESSION_TTL_HOURS` is dead configuration.
- Clinic agreement template and some conditional field rules remain product/legal decisions in
  `docs/open-questions.md`.
- No route-by-route authorization test matrix; service-level RBAC tests and E2E isolation tests
  cover the important paths but not every route.
- No `vercel.json`; deployment relies on dashboard settings.
