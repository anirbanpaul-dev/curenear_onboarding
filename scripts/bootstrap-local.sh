#!/usr/bin/env bash
# Prepare a clean checkout for local development.
# Run from anywhere in the repo: bash scripts/bootstrap-local.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

for command in git node corepack pnpm docker; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is not installed or not on PATH"
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" = "22" ] || fail "Node 22 is required (found $(node -v)). Run: nvm use"

docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required (docker compose version)"

if [ ! -f .env ]; then
  cp .env.example .env
  printf 'Created .env from .env.example. Set SEED_ADMIN_PASSWORD before seeding.\n'
fi
for target in apps/web/.env.local apps/worker/.env packages/db/.env; do
  if [ ! -f "$target" ]; then
    cp .env.example "$target"
    printf 'Created %s from .env.example.\n' "$target"
  fi
done

printf '\nStarting PostgreSQL, MinIO, bucket bootstrap and Mailpit...\n'
docker compose up -d db minio minio-init mailpit

printf '\nInstalling dependencies...\n'
corepack enable
pnpm install --frozen-lockfile

printf '\nGenerating Prisma client, migrating and seeding...\n'
pnpm db:generate
pnpm db:migrate
pnpm db:seed

cat <<'EOF'

Local stack is ready.

  App:      http://localhost:3000
  Mailpit:  http://localhost:8025
  MinIO:    http://localhost:9001

Next steps:
  1. pnpm dev
  2. Sign in with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from .env and change the password.
  3. Optional, for PIN search: pnpm import:pincodes data/all_india_pin_code.csv
EOF
