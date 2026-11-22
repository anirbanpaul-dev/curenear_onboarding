#!/usr/bin/env bash
# Create a compressed custom-format PostgreSQL backup.
#
#   bash scripts/backup-db.sh                 # backups/curenear-<timestamp>.dump
#   bash scripts/backup-db.sh /secure/path.dump
#
# DATABASE_URL comes from the environment, or from .env at the repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v pg_dump >/dev/null 2>&1 || {
  echo "ERROR: pg_dump is not installed (install PostgreSQL client tools)" >&2
  exit 1
}

if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2-)"
  DATABASE_URL="${DATABASE_URL%\"}"
  DATABASE_URL="${DATABASE_URL#\"}"
fi
[ -n "${DATABASE_URL:-}" ] || {
  echo "ERROR: DATABASE_URL is not set" >&2
  exit 1
}

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${1:-backups/curenear-${STAMP}.dump}"
mkdir -p "$(dirname "$OUT")"
umask 077

echo "Backing up to $OUT"
pg_dump --format=custom --no-owner --no-privileges --file "$OUT" "$DATABASE_URL"

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$OUT" | tee "$OUT.sha256"
else
  shasum -a 256 "$OUT" | tee "$OUT.sha256"
fi
echo "Backup complete. Copy it off this machine."
