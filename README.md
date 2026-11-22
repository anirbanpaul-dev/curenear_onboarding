# CureNear Provider Onboarding Portal

Internal web application for onboarding and verifying healthcare providers on their behalf.
Administrators create staff accounts, staff onboard doctor practices, clinics, pharmacies,
diagnostic centres and care providers, and administrators review, verify and analyse coverage.
Providers themselves do not sign in.

Node.js 22 · TypeScript · Next.js 15 App Router · PostgreSQL · Prisma · Zod · pg-boss · pino ·
Vitest · Playwright · Docker Compose · pnpm workspaces.

## Start here

| Audience | Document |
| --- | --- |
| New developer | [`docs/QUICKSTART.md`](docs/QUICKSTART.md) then [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) §2–6 |
| DevOps | [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) §7–14 |
| Project owner | [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) §1, §7, §15–16 |
| Repository facts | [`docs/handover/repo-inventory.md`](docs/handover/repo-inventory.md) |

## Quick start

```bash
corepack enable
cp .env.example .env && cp .env.example apps/web/.env.local && cp .env.example apps/worker/.env && cp .env.example packages/db/.env
pnpm install --frozen-lockfile
docker compose up -d db minio minio-init mailpit
pnpm db:generate
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Open <http://localhost:3000> and sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from
`.env`; the seed forces a password change. Mailpit is at <http://localhost:8025> and the MinIO
console at <http://localhost:9001>.

`bash scripts/bootstrap-local.sh` performs the same setup with prerequisite checks.

## Layout

```
apps/web        Next.js UI and /api/v1 route handlers
apps/worker     Outbox dispatcher and pg-boss jobs
packages/db     Prisma schema, migrations, repositories, seed
packages/shared Zod schemas, field registry, RBAC, environment validation
packages/config Shared TypeScript and ESLint configuration
```

Layering: route handler → service → repository. Repositories are the only code that touches Prisma.
Services own business rules, transactions, audit and outbox writes.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Web on `:3000` and the worker, watched. |
| `pnpm dev:web` / `pnpm dev:worker` | Run one side. |
| `pnpm build` | Typecheck packages and build Next. |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | Quality gates. |
| `pnpm test:int` | Integration/contract tests; Testcontainers need Docker. |
| `pnpm e2e` | Playwright journeys and axe checks. |
| `pnpm test:coverage` | Shared coverage gate and web service coverage. |
| `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:seed` | Prisma client, migrations, bootstrap admin/reference data. |
| `pnpm db:rebuild-stats` | Rebuild PIN analytics. |
| `pnpm import:pincodes <csv>` | Import the India Post PIN directory. |
| `pnpm check:env -- <file>` | Validate env without starting the app. |
| `pnpm perf:load` | Autocannon load test (after `pnpm perf:seed`). |

## Health

| Endpoint | Meaning |
| --- | --- |
| `GET /api/health` | Liveness; no dependency calls. |
| `GET /api/ready` | 200 only when PostgreSQL and S3 both answer; otherwise 503. |

The worker has no HTTP port; its liveness indicator is the JSON `worker_started` log line and the
`job_runs` table. Both probes return the standard envelope and echo `x-request-id`.

## Security and data

- Database-backed opaque sessions in an `HttpOnly; Secure; SameSite=Lax` cookie; only token hashes
  are stored.
- Mutations require a same-origin `Origin`/`Referer`; security headers are set in middleware and
  `next.config.mjs`.
- Staff see only providers they created and only while draft/changes-requested. Admins review and
  manage accounts.
- Audit rows store changed field keys, not values. Event payloads carry identifiers only.
- Documents are private and served through short-lived presigned URLs.

Known gaps (distributed rate limiting, malware scanning, MFA, observability, legal sign-offs) are
listed with severity in [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md#15-known-gaps-before-go-live).

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) | Handover, local setup, deployment options, operations, gaps. |
| [`docs/QUICKSTART.md`](docs/QUICKSTART.md) | One-page local and deploy checklist. |
| [`docs/handover/repo-inventory.md`](docs/handover/repo-inventory.md) | Verified apps, scripts, env vars, services, jobs, ports. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branching, PRs, commits, secret handling. |
| [`docs/CureNear_Provider_Onboarding_Field_Spec.md`](docs/CureNear_Provider_Onboarding_Field_Spec.md) | Source of truth for onboarding fields. |
| [`docs/decisions.md`](docs/decisions.md) | Architecture and product decisions. |
| [`docs/open-questions.md`](docs/open-questions.md) | Legal/product questions still open. |
| [`docs/pincode-import.md`](docs/pincode-import.md) | Official PIN CSV import. |
| [`docs/testing.md`](docs/testing.md) | Test layers, coverage reality, CI. |
| [`docs/performance.md`](docs/performance.md) | 100k-provider load results. |
| [`docs/openapi.json`](docs/openapi.json) | Partial OpenAPI 3.1 document. |
| [`docs/events.md`](docs/events.md) | Domain event contract. |
