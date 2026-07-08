#!/usr/bin/env bash
# db-backup.sh — Export/Import database for TradingStats with deduplication support
# Usage:
#   ./db-backup.sh export [filename]          # Export full database (schema + data)
#   ./db-backup.sh export-data [filename]     # Export only data (INSERT statements)
#   ./db-backup.sh import <filename>          # Import with deduplication (ON CONFLICT DO NOTHING)
#   ./db-backup.sh import-clean <filename>    # Import with TRUNCATE first (replaces all data)
#
# Requires: docker compose, .env with DATABASE_URL, container 'db' running

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# CONFIGURATION & HELPERS
# ──────────────────────────────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${PROJECT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "❌ Error: .env file not found at ${ENV_FILE}"
  exit 1
fi

# shellcheck disable=SC1091
source "${ENV_FILE}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "❌ Error: DATABASE_URL not set in .env"
  exit 1
fi

# Parse DATABASE_URL: postgresql://user:pass@host:port/dbname?schema=public
URL="${DATABASE_URL#postgresql://}"
if [[ "$URL" =~ ^([^:@]+):([^:@]+)@ ]]; then
  DB_USER="${BASH_REMATCH[1]}"
  DB_PASSWORD="${BASH_REMATCH[2]}"
  URL="${URL#*@}"
else
  DB_USER="${PGUSER:-postgres}"
  DB_PASSWORD="${PGPASSWORD:-}"
fi

if [[ "$URL" =~ ^([^:/]+):([0-9]+)/([^?]+) ]]; then
  DB_HOST="${BASH_REMATCH[1]}"
  DB_PORT="${BASH_REMATCH[2]}"
  DB_NAME="${BASH_REMATCH[3]}"
else
  DB_HOST="localhost"
  DB_PORT="5432"
  DB_NAME="${URL%%/*}"
fi

export PGPASSWORD="${DB_PASSWORD}"

run_in_db() {
  docker compose exec -T db "$@"
}

run_psql() {
  run_in_db psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" "$@"
}

run_pg_dump() {
  run_in_db pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" "$@"
}

run_pg_restore() {
  run_in_db pg_restore -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" "$@"
}

usage() {
  cat <<'EOF'
Usage:
  db-backup.sh export [filename]          Export full database (schema + data)
  db-backup.sh export-data [filename]     Export only data (INSERT statements, no schema)
  db-backup.sh import <filename>          Import with deduplication (ON CONFLICT DO NOTHING)
  db-backup.sh import-clean <filename>    Import with TRUNCATE first (full replace)

Environment:
  Reads DATABASE_URL from .env in project root.
  Container 'db' must be running (docker compose up -d db).

Examples:
  ./db-backup.sh export
  ./db-backup.sh export backup_20260707.sql
  ./db-backup.sh export-data data_only.sql
  ./db-backup.sh import backup_20260707.sql
  ./db-backup.sh import-clean backup_20260707.sql
EOF
  exit 1
}

# ──────────────────────────────────────────────────────────────────────
# EXPORT COMMANDS
# ──────────────────────────────────────────────────────────────────────

cmd_export() {
  local filename="${1:-db-backup_$(date +%Y%m%d_%H%M%S).sql}"
  local filepath="${PROJECT_DIR}/${filename}"

  echo "📤 Exporting FULL database (schema + data) to ${filepath}..."
  run_pg_dump --no-owner --no-privileges --format=plain > "${filepath}"
  echo "✅ Export completed: ${filepath} ($(du -h "${filepath}" | cut -f1))"
}

cmd_export_data() {
  local filename="${1:-db-data_$(date +%Y%m%d_%H%M%S).sql}"
  local filepath="${PROJECT_DIR}/${filename}"

  echo "📤 Exporting DATA ONLY (INSERT statements) to ${filepath}..."
  run_pg_dump \
    --no-owner --no-privileges \
    --data-only --column-inserts \
    --format=plain > "${filepath}"
  echo "✅ Data export completed: ${filepath} ($(du -h "${filepath}" | cut -f1))"
}

# ──────────────────────────────────────────────────────────────────────
# IMPORT COMMANDS
# ──────────────────────────────────────────────────────────────────────

cmd_import() {
  local filename="${1:?Missing filename for import}"
  local filepath="${PROJECT_DIR}/${filename}"

  if [[ ! -f "${filepath}" ]]; then
    echo "❌ Error: File not found: ${filepath}"
    exit 1
  fi

  echo "📥 Importing with deduplication (ON CONFLICT DO NOTHING)..."
  echo "   This will skip rows that already exist (by PRIMARY KEY)."

  # Create a temporary SQL file that wraps INSERTs with ON CONFLICT DO NOTHING
  local tmp_sql=$(mktemp)
  trap 'rm -f "$tmp_sql"' EXIT

  echo "🔄 Processing dump to add ON CONFLICT DO NOTHING..."
  process_dump_for_dedup "${filepath}" "${tmp_sql}"

  echo "📥 Executing import..."
  run_psql -v ON_ERROR_STOP=1 -f "${tmp_sql}"
  echo "✅ Import completed (duplicates skipped)."
}

cmd_import_clean() {
  local filename="${1:?Missing filename for import}"
  local filepath="${PROJECT_DIR}/${filename}"

  if [[ ! -f "${filepath}" ]]; then
    echo "❌ Error: File not found: ${filepath}"
    exit 1
  fi

  echo "📥 Importing with FULL REPLACE (TRUNCATE + import)..."
  echo "⚠️  This will DELETE all existing data in target tables!"

  # First, disable triggers and truncate tables that will be imported
  # We extract table names from COPY/INSERT statements
  local tables=$(grep -E '^(COPY|INSERT INTO)' "${filepath}" | \
    sed -E 's/^(COPY|INSERT INTO) +([a-zA-Z_][a-zA-Z0-9_]*).*/\2/' | \
    sort -u)

  if [[ -n "${tables}" ]]; then
    echo "🔄 Truncating tables: ${tables}"
    for tbl in ${tables}; do
      run_psql -c "TRUNCATE TABLE \"${tbl}\" CASCADE;" || true
    done
  fi

  echo "📥 Executing clean import..."
  run_psql -v ON_ERROR_STOP=1 -f "${filepath}"
  echo "✅ Clean import completed."
}

# ──────────────────────────────────────────────────────────────────────
# HELPER: Process dump to add ON CONFLICT DO NOTHING to INSERT statements
# ──────────────────────────────────────────────────────────────────────

process_dump_for_dedup() {
  local input_file="$1"
  local output_file="$2"

  # We use awk to process the SQL dump line by line
  # Strategy: Find INSERT statements and append ON CONFLICT DO NOTHING before the semicolon
  # This works for --column-inserts format: INSERT INTO table (col1, col2) VALUES (...), (...);
  awk '
    BEGIN { in_insert = 0; insert_buffer = ""; paren_depth = 0; }
    {
      line = $0
      # Detect start of INSERT statement
      if (!in_insert && line ~ /^INSERT INTO [^ ]+ \(/) {
        in_insert = 1
        insert_buffer = line
        # Count parentheses to find the end
        for (i = 1; i <= length(line); i++) {
          c = substr(line, i, 1)
          if (c == "(") paren_depth++
          else if (c == ")") paren_depth--
        }
        next
      }

      if (in_insert) {
        insert_buffer = insert_buffer "\n" line
        for (i = 1; i <= length(line); i++) {
          c = substr(line, i, 1)
          if (c == "(") paren_depth++
          else if (c == ")") paren_depth--
        }
        # Check if statement ends (semicolon at paren_depth 0)
        if (paren_depth == 0 && line ~ /;[[:space:]]*$/) {
          # Insert ON CONFLICT DO NOTHING before the final semicolon
          sub(/;[[:space:]]*$/, " ON CONFLICT DO NOTHING;", insert_buffer)
          print insert_buffer
          in_insert = 0
          insert_buffer = ""
          paren_depth = 0
        }
        next
      }

      # Not in INSERT - pass through unchanged
      print line
    }
    END {
      if (in_insert) {
        # Incomplete INSERT at EOF - print as-is
        print insert_buffer
      }
    }
  ' "${input_file}" > "${output_file}"

  # Also handle COPY statements - convert to INSERT with ON CONFLICT (more complex, skip for now)
  # For COPY, we would need to parse CSV data which is heavy in bash.
  # Recommendation: use --column-inserts during export for deduplication support.
}

# ──────────────────────────────────────────────────────────────────────
# MAIN DISPATCH
# ──────────────────────────────────────────────────────────────────────

case "${1:-}" in
  export)
    cmd_export "${2:-}"
    ;;
  export-data)
    cmd_export_data "${2:-}"
    ;;
  import)
    cmd_import "${2:-}"
    ;;
  import-clean)
    cmd_import_clean "${2:-}"
    ;;
  *)
    usage
    ;;
esac