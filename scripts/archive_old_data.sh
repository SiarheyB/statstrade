#!/usr/bin/env bash
# Archive old data from PostgreSQL to compressed files.
# Usage: ./scripts/archive_old_data.sh [retention_days]
# Example: ./scripts/archive_old_data.sh 365

set -euo pipefail

RETENTION_DAYS=${1:-365}
DB_URL=${DATABASE_URL:-"postgresql://tradestats:tradestats@localhost:5432/tradestats"}
ARCHIVE_DIR=${ARCHIVE_DIR:-/var/lib/postgresql/archives}
DATE_STAMP=$(date -u +%Y%m%d_%H%M%S)

# Create archive directory
mkdir -p "$ARCHIVE_DIR"

# Tables to archive (rollup tables are the main long-term data)
TABLES=("ObSnapshotRollup" "ObRollupBucket")

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Starting archive of data older than $RETENTION_DAYS days..."

for TABLE in "${TABLES[@]}"; do
    ARCHIVE_FILE="${ARCHIVE_DIR}/${TABLE}_before_${DATE_STAMP}.csv.gz"
    echo "  Archiving $TABLE -> $ARCHIVE_FILE"

    # Export old data to compressed CSV
    psql "$DB_URL" -c "\
        COPY (
            SELECT * FROM \"$TABLE\"
            WHERE bucket < NOW() - INTERVAL '${RETENTION_DAYS} days'
        ) TO STDOUT WITH CSV HEADER" | gzip > "$ARCHIVE_FILE"

    ROW_COUNT=$(zcat "$ARCHIVE_FILE" 2>/dev/null | wc -l || echo 0)
    ROW_COUNT=$((ROW_COUNT - 1))  # subtract header

    if [[ $ROW_COUNT -gt 0 ]]; then
        echo "    Exported $ROW_COUNT rows. Deleting from database..."
        # Delete exported rows
        psql "$DB_URL" -c "\
            DELETE FROM \"$TABLE\"
            WHERE bucket < NOW() - INTERVAL '${RETENTION_DAYS} days';"
        echo "    Deleted $ROW_COUNT rows from $TABLE."
    else
        echo "    No rows to archive for $TABLE."
        rm -f "$ARCHIVE_FILE"
    fi
done

# Vacuum after large deletions
echo "  Running VACUUM ANALYZE..."
psql "$DB_URL" -c "VACUUM ANALYZE;"

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Archive completed."

# Optional: Clean up archives older than 2 years (keep 730 days)
ARCHIVE_RETENTION=730
echo "  Cleaning archives older than $ARCHIVE_RETENTION days..."
find "$ARCHIVE_DIR" -name "*.csv.gz" -mtime +$ARCHIVE_RETENTION -delete 2>/dev/null || true

echo "Done."