#!/usr/bin/env bash
# docker-entrypoint.sh – entrypoint for the app container.
# Runs before prisma migrate deploy and Next.js start.
# Automatically fixes migration 20260707073006 if it's marked as failed.

set -euo pipefail

log() { echo "[entrypoint] $*"; }

fix_migration_if_needed() {
  # DATABASE_URL is provided via env (from docker-compose / .env)
  if psql "$DATABASE_URL" -tAc "
    SELECT 1 FROM _prisma_migrations
    WHERE migration_name = '20260707073006' AND finished_at IS NULL
  " 2>/dev/null | grep -q 1; then
    log "⚠️  Detected failed migration 20260707073006 – applying fix."
    psql "$DATABASE_URL" -c "
      UPDATE _prisma_migrations
      SET finished_at = NOW(),
          logs = 'auto-fixed by entrypoint (P3009)'
      WHERE migration_name = '20260707073006';
    "
    log "✅  Migration marked as applied."
  else
    log "ℹ️  Migration 20260707073006 already applied – nothing to do."
  fi
}

# Allow skipping the fix via env var (debugging)
if [[ "${SKIP_MIGRATION_FIX:-}" != "true" ]]; then
  fix_migration_if_needed
fi

log "▶️  Running prisma migrate deploy…"
npx prisma migrate deploy

log "▶️  Starting Next.js…"
exec npm start