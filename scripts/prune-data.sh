#!/usr/bin/env bash
# Script to purge old data from collector tables based on retention settings.
# Usage: ./scripts/prune-data.sh

set -euo pipefail

# Load environment variables from .env (if exists) or use defaults
if [[ -f .env ]]; then
  source .env
fi

# Default values (matching those in collector/index.mjs)
RAW_RETENTION_DAYS=${RAW_RETENTION_DAYS:-30}
ROLLUP_RETENTION_DAYS=${ROLLUP_RETENTION_DAYS:-365}
DATABASE_URL=${DATABASE_URL:-postgresql://tradestats:tradestats@localhost:5432/tradestats}

echo "Purging data older than $RAW_RETENTION_DAYS days from ObSnapshot (raw data)"
echo "Purging data older than $ROLLUP_RETENTION_DAYS days from rollup tables"

# Connect to DB and run deletions
psql "$DATABASE_URL" <<SQL
-- Delete old raw snapshots
DELETE FROM "ObSnapshot" WHERE t < NOW() - INTERVAL '${RAW_RETENTION_DAYS} days';

-- Delete old rollup snapshots
DELETE FROM "ObSnapshotRollup" WHERE bucket < NOW() - INTERVAL '${ROLLUP_RETENTION_DAYS} days';

-- Delete old rollup buckets
DELETE FROM "ObRollupBucket" WHERE bucket < NOW() - INTERVAL '${ROLLUP_RETENTION_DAYS} days';

VACUUM ANALYZE;
SQL

echo "Purge completed."