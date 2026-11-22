#!/usr/bin/env bash
# Restore a custom-format PostgreSQL backup. This is destructive.
#
#   bash scripts/restore-db.sh backups/curenear-20260101T000000Z.dump
#   bash scripts/restore-db.sh file.dump --yes       # automation only
#
# DATABASE_URL comes from the environment, or from .env at the repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FILE="${1:-}"
CONFIRM="${2:-}"
[ -n "$FILE" ] || {
  echo "Usage: bash scripts/restore-db.sh <backup.dump> [--yes]" >&2
  exit 1
}
[ -f "$FILE" ] || {
  echo "ERROR: backup file not found: $FILE" >&2
  exit 1
}

command -v pg_restore >/dev/null 2>&1 || {
  echo "ERROR: pg_restore is not installed (install PostgreSQL client tools)" >&2
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

HOST="$(node -e "try{console.log(new URL(process.argv[1]).host)}catch{console.log('unknown')}" "$DATABASE_URL")"
echo "About to DROP and restore objects in: $HOST"
echo "File: $FILE"
if [ "$CONFIRM" != "--yes" ]; then
  printf 'Type RESTORE to continue: '
  read -r answer
  [ "$answer" = "RESTORE" ] || {
    echo "Aborted."
    exit 1
  }
fi

pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$DATABASE_URL" "$FILE"
echo "Restore complete. Run the smoke test and check /api/ready."
