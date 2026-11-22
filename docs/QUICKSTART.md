# Quick start

Full details: [`docs/DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md).

## Clone to running locally (10 commands)

```bash
git clone git@github.com:<ORG>/<REPO>.git
cd <REPO>
corepack enable
cp .env.example .env
cp .env.example apps/web/.env.local
pnpm install --frozen-lockfile
docker compose up -d db minio minio-init mailpit
pnpm db:generate
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Open <http://localhost:3000>, sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, change the
password. Mailpit: <http://localhost:8025>. MinIO: <http://localhost:9001>.

## Deploy checklist (15 lines)

1. Create the production database and private S3 bucket.
2. Generate `SESSION_SECRET` with `openssl rand -base64 48`.
3. Fill the platform env from `.env.production.example`; no `CHANGE_ME` may remain.
4. Run `pnpm check:env -- <production-env-file>`.
5. Set `APP_URL` to the public HTTPS origin.
6. Configure SMTP with SPF/DKIM/DMARC.
7. Apply migrations with `.github/workflows/migrate.yml` (manual, environment-gated).
8. Deploy the worker and confirm `worker_started` in its logs.
9. Deploy web and confirm `/api/ready` returns 200.
10. Seed the first admin once with `pnpm db:seed`.
11. Sign in and change the password immediately.
12. Remove `SEED_ADMIN_*` from the environment.
13. Configure S3 CORS for the web origin only.
14. Run the smoke test with `SMOKE_REQUIRE_READY=1`.
15. Enable backups, uptime checks and record the release.
