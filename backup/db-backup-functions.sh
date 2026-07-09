#!/bin/bash
# db-backup-functions.sh — Optimized for TradingStats with Docker
# Uses docker compose exec to interact with the db container only

set -euo pipefail

# Configuration
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Пакет backup/ лежит внутри корня проекта, поэтому корень — на уровень выше
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.yml"
readonly LOG_FILE="${SCRIPT_DIR}/db-backup-functions.log"
readonly TMP_DIR="${SCRIPT_DIR}/tmp"
mkdir -p "${TMP_DIR}"

# Logging functions
log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] $*" >> "${LOG_FILE}"
}

error() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] $*" >> "${LOG_FILE}"
  echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] $*" >&2
}

# Parse DATABASE_URL
parse_db_url() {
  local url="${DATABASE_URL:-}"
  url="${url#postgresql://}"
  if [[ "$url" =~ ^([^:@]+):([^:@]+)@ ]]; then
    DB_USER="${BASH_REMATCH[1]}"
    DB_PASSWORD="${BASH_REMATCH[2]}"
    url="${url#*@}"
  else
    DB_USER="${PGUSER:-tradestats}"
    DB_PASSWORD="${PGPASSWORD:-tradestats}"
  fi
  if [[ "$url" =~ ^([^:/]+):([0-9]+)/([^?]+) ]]; then
    DB_HOST="${BASH_REMATCH[1]}"
    DB_PORT="${BASH_REMATCH[2]}"
    DB_NAME="${BASH_REMATCH[3]}"
  else
    DB_HOST="localhost"
    DB_PORT="5432"
    DB_NAME="${url%%/*}"
  fi
  export PGPASSWORD="${DB_PASSWORD}"
}

# Execute command inside the db container
exec_in_db() {
  local db_host="${DB_HOST:-db}"
  local db_port="${DB_PORT:-5432}"
  local db_user="${DB_USER}"
  local db_password="${DB_PASSWORD}"
  local db_name="${DB_NAME}"

  # Если мы запущены внутри контейнера app (Docker CLI отсутствует),
  # то подключаемся напрямую к хосту postgres (обычно db:5432).
  # На хосте Docker доступен, используем docker compose exec.
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker compose -f "${COMPOSE_FILE}" exec -T db env \
      PGUSER="${db_user}" \
      PGPASSWORD="${db_password}" \
      PGDATABASE="${db_name}" \
      "$@"
  else
    # Прямое подключение к хосту БД
    PGPASSWORD="${db_password}" \
      psql -h "${db_host}" -p "${db_port}" -U "${db_user}" -d "${db_name}" "$@"
  fi
}

# Get list of all user tables
list_tables() {
  exec_in_db psql -Atq -c "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename"
}

# Check if table exists
check_table() {
  local table="$1"
  [[ -z "${table}" ]] && return 1
  exec_in_db psql -Atq -c "SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = '${table}';" | grep -q 1
}

# Check database connection
check_db_connection() {
  if ! exec_in_db pg_isready >/dev/null 2>&1; then
    error "Не удалось подключиться к контейнеру db"
    error "Запустите: docker compose up -d db"
    return 1
  fi
}

# ─────────────────────────────────────────────────────
# EX export_functions

export_full() {
  local output_file="${1:-${TMP_DIR}/db-export_$(date +%Y%m%d_%H%M%S).sql}"
  log "Starting full database export to ${output_file}"

  exec_in_db pg_dump \
    --no-owner --no-privileges --no-acl \
    --column-inserts --inserts \
    --format=plain \
    "${DB_NAME}" > "${output_file}" || {
    error "Full export failed"
    return 1
  }

  log "Full export completed: $(du -h "${output_file}" | cut -d' ' -f1)"
  echo "${output_file}"
}

export_data_only() {
  local output_file="${1:-${TMP_DIR}/db-data_$(date +%Y%m%d_%H%M%S).sql}"
  log "Starting data export for dedupation to ${output_file}"

  : > "${output_file}"

  local failed_tables=""
  local tables
  tables=$(list_tables)

  while IFS= read -r table; do
    [[ -z "${table}" ]] && continue
    log "Exporting data from table: ${table}"

    if exec_in_db pg_dump \
        --data-only --disable-triggers \
        --column-inserts --inserts \
        --table="\"${table}\"" >> "${output_file}" 2>/dev/null; then
      log "Table ${table} exported"
    else
      error "Failed to export table: ${table}"
      failed_tables="${failed_tables} ${table}"
    fi
  done <<< "${tables}"

  if [[ -n "${failed_tables}" ]]; then
    error "Failed to export tables:${failed_tables}"
    return 1
  fi

  log "Data export completed: ${output_file} ($(du -h "${output_file}" | cut -d' ' -f1))"
  echo "${output_file}"
}

export_analytics() {
  local output_file="${1:-${TMP_DIR}/db-analytics_$(date +%Y%m%d_%H%M%S).sql}"
  log "Starting analytics export to ${output_file}"

  : > "${output_file}"

  # Define analytics tables based on schema.prisma
  local analytics_tables="ObSnapshotRollup ObRollupBucket ObBigTrade ObTrade ObFootprint"

  local failed_tables=""

  for table in ${analytics_tables}; do
    if ! check_table "${table}"; then
      log "Table ${table} does not exist, skipping"
      continue
    fi

    log "Exporting analytics table: ${table}"
    if exec_in_db pg_dump \
        --data-only --disable-triggers \
        --column-inserts --inserts \
        --table="\"${table}\"" >> "${output_file}" 2>/dev/null; then
      log "Table ${table} exported"
    else
      error "Failed to export analytics table: ${table}"
      failed_tables="${failed_tables} ${table}"
    fi
  done

  if [[ -n "${failed_tables}" ]]; then
    error "Failed to export analytics tables:${failed_tables}"
    return 1
  fi

  log "Analytics export completed: ${output_file} ($(du -h "${output_file}" | cut -d' ' -f1))"
  echo "${output_file}"
}

# ─────────────────────────────────────────────────────
# IMPORT FUNCTIONS

import_with_dedup() {
  local input_file="$1"
  local output_file="${TMP_DIR}/dedup_$(date +%s).sql"

  [[ -f "${input_file}" ]] || { error "Input file not found: ${input_file}"; return 1; }

  log "Starting dedup import from ${input_file}"

  local analytics_tables="Trade ObSnapshotRollup ObRollupBucket ObBigTrade ObTrade ObFootprint"
  local cleanup_failed=""

  # Clean up existing tables (only if they exist)
  for t in ${analytics_tables}; do
    if check_table "${t}"; then
      exec_in_db psql -c "TRUNCATE TABLE \"${t}\" CASCADE" && log "Table ${t} cleaned" || {
        log "Warning: Could not clean table ${t}"
        cleanup_failed="${cleanup_failed} ${t}"
      }
    fi
  done

  log "Continuing despite cleanup issues (${cleanup_failed})"

  # Process file for ON CONFLICT DO NOTHING using helper function
  # Use here string to avoid file handling issues inside the container
  local processed_sql
  processed_sql=$(process_inserts_for_dedup "${input_file}" "")

  # Load processed data into the container (better than passing file)
  exec_in_db psql --quiet <<SQL
$(process_inserts_for_dedup "${input_file}" "")
SQL

  rm -f "${output_file}"
  log "Dedup import completed successfully"
}

import_clean() {
  local input_file="$1"

  [[ -f "${input_file}" ]] || { error "Input file not found: ${input_file}"; return 1; }

  log "Starting clean import from ${input_file}"

  # Stop all connections
  exec_in_db psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}';" || true

  # Drop and recreate database
  docker compose -f "${COMPOSE_FILE}" exec -T db env PGPASSWORD="${DB_PASSWORD}" \
    dropdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" "${DB_NAME}" || true

  docker compose -f "${COMPOSE_FILE}" exec -T db env PGPASSWORD="${DB_PASSWORD}" \
    createdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" "${DB_NAME}" || {
    error "Failed to create database"
    return 1
  }

  # Restore database using psql for plain SQL dump (pipe content from host)
  cat "${input_file}" | docker compose -f "${COMPOSE_FILE}" exec -T db env PGPASSWORD="${DB_PASSWORD}" \
    psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" >> "${LOG_FILE}" 2>&1 || {
    error "Failed to restore database"
    return 1
  }

  log "Clean import completed successfully"
}

# ─────────────────────────────────────────────────────
# HELPER FUNCTIONS

process_inserts_for_dedup() {
  local input_file="$1"
  local output_file="$2"

  awk '
    BEGIN { in_insert=0; buffer=""; depth=0; in_ddl=0 }

    # DDL: skip the whole statement (multi-line) until terminating ";"
    /^(CREATE |ALTER |DROP |GRANT |REVOKE |COPY |SET |--)/ {
      if (in_insert) { flush(); }
      in_ddl=1
    }
    in_ddl {
      if ($0 ~ /;[[:space:]]*$/) in_ddl=0
      next
    }

    # Start of an INSERT statement
    !in_insert && /^INSERT INTO/ {
      in_insert=1
      buffer=$0
      n=split($0, ch, "")
      for (i=1; i<=n; i++) { if (ch[i]=="(") depth++; else if (ch[i]==")") depth-- }
      if (depth==0 && $0 ~ /;[[:space:]]*$/) { flush(); }
      next
    }

    # Continuation of an INSERT statement
    in_insert {
      buffer = buffer "\n" $0
      n=split($0, ch, "")
      for (i=1; i<=n; i++) { if (ch[i]=="(") depth++; else if (ch[i]==")") depth-- }
      if (depth==0 && $0 ~ /;[[:space:]]*$/) { flush(); }
      next
    }

    # Skip everything else (blank lines, comments, SET, etc.)
    { next }

    function flush() {
      if (in_insert && buffer != "") {
        sub(/;[[:space:]]*$/, " ON CONFLICT DO NOTHING;", buffer)
        print buffer
      }
      in_insert=0; buffer=""; depth=0
    }
  ' "$input_file" > "${output_file:-/dev/stdout}"
}

create_basic_dump() {
  local output_file="${1:-${TMP_DIR}/basic_dump_$(date +%Y%m%d_%H%M%S).sql}"

  log "Starting basic dump creation to ${output_file}"

  : > "${output_file}"
  local tables
  tables=$(list_tables)

  while IFS= read -r table; do
    [[ -z "${table}" ]] && continue

    log "Creating dump for table: ${table}"

    # Export DDL and data
    exec_in_db pg_dump \
      --schema-only --no-owner --no-privileges --table="\"${table}\"" >> "${output_file}" 2>>"${LOG_FILE}"
    exec_in_db pg_dump \
      --data-only --column-inserts --inserts --table="\"${table}\"" >> "${output_file}" 2>>"${LOG_FILE}"
  done <<< "${tables}"

  log "Basic dump completed: ${output_file}"
  echo "${output_file}"
}

# ─────────────────────────────────────────────────────
# HELP AND COMMAND LINE INTERFACE

show_help() {
  cat <<EOF
=== TradingStats Database Backup Functions ===

Commands:
  export_full                Export entire database (schema + data)
  export_data_only [output]  Export data only for dedupation
  export_analytics [output]  Export analytics tables only
  import_with_dedup <file>   Import with ON CONFLICT DO NOTHING deduplication
  import_clean <file>        Import with complete database replacement
  create_basic_dump [output] Create basic DDL + INSERT dump
  show_help                  Show this help

Usage:
  backup/db-backup-functions.sh export_full
  backup/db-backup-functions.sh export_data_only
  backup/db-backup-functions.sh export_analytics
  backup/db-backup-functions.sh import_with_dedup data.sql
  backup/db-backup-functions.sh import_clean full.sql
  backup/db-backup-functions.sh create_basic_dump

Files:
  db-backup-functions.log - Log file
  tmp/                    - Temporary files

EOF
  exit 0
}

# ─────────────────────────────────────────────────────
# MAIN EXECUTION

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  # .env лежит в корне проекта (на уровень выше пакета backup/)
  if [[ -f "${PROJECT_ROOT}/.env" ]]; then
    set -a
    source "${PROJECT_ROOT}/.env"
    set +a
  elif [[ -f "${SCRIPT_DIR}/.env" ]]; then
    set -a
    source "${SCRIPT_DIR}/.env"
    set +a
  fi

  parse_db_url

  case "${1:-}" in
    export_full) export_full "${2:-}" ;;
    export_data_only) export_data_only "${2:-}" ;;
    export_analytics) export_analytics "${2:-}" ;;
    import_with_dedup)
      check_db_connection
      import_with_dedup "${2:-}"
      ;;
    import_clean)
      check_db_connection
      import_clean "${2:-}"
      ;;
    create_basic_dump) create_basic_dump "${2:-}" ;;
    help|"*") show_help ;;
    *) echo "Unknown command: ${1:-}"; show_help ;;
  esac
fi