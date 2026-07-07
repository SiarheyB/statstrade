#!/bin/bash
# db-backup-functions.sh — Функции для экспорта и импорта базы данных TradingStats
# Включает вспомогательные функции: экспорт данных только INSERT (с дедубликацией)

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# КОНФИГУРАЦИЯ И ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ
# ──────────────────────────────────────────────────────────────────────

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly LOG_FILE="${SCRIPT_DIR}/db-backup-functions.log"
readonly TMP_DIR="${SCRIPT_DIR}/tmp"

# Создать временную директорию
mkdir -p "${TMP_DIR}"

# Инициализация журнала
log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] $*" >> "${LOG_FILE}"
}

error() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] $*" >> "${LOG_FILE}"
  echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] $*" >&2
}

# ──────────────────────────────────────────────────────────────────────
# ПАРСИНГ DATABASE_URL
# ──────────────────────────────────────────────────────────────────────

parse_db_url() {
  local url="${DATABASE_URL}"

  # Удаляем префикс postgresql://
  url="${url#postgresql://}"

  # Извлекаем логин:пароль если есть
  if [[ "$url" =~ ^([^:@]+):([^:@]+)@ ]]; then
    DB_USER="${BASH_REMATCH[1]}"
    DB_PASSWORD="${BASH_REMATCH[2]}"
    url="${url#*@}"
  else
    DB_USER="${PGUSER:-postgres}"
    DB_PASSWORD="${PGPASSWORD:-}"
  fi

  # Извлекаем хост, порт и имя базы данных
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

# ──────────────────────────────────────────────────────────────────────
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ DOCKER И POSTGRESQL
# ──────────────────────────────────────────────────────────────────────

# Выполнение команд внутри контейнера БД (без TTY, потоковый вывод)
exec_db() {
  docker compose exec -T db "$@"
}

# Выполнение команды psql в контейнере БД
run_psql() {
  exec_db psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" "$@"
}

# Получение списка таблиц
list_tables() {
  exec_db psql -Atq -c "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
}

# Проверка подключения к БД
check_db_connection() {
  if ! exec_db pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
    error "Невозможно подключиться к PostgreSQL в контейнере 'db'"
    error "Убедитесь, что контейнер 'db' запущен: docker compose up -d db"
    return 1
  fi
}

# ──────────────────────────────────────────────────────────────────────
# ФУНКЦИИ ЭКСПОРТА
# ──────────────────────────────────────────────────────────────────────

# Экспорт всей базы данных (схема + данные)
export_full() {
  local output_file="${1:-${TMP_DIR}/db-export_$(date +%Y%m%d_%H%M%S).sql}"

  log "Начинаю экспорт всей базы данных в ${output_file}"

  # Экспорт в формате plain SQL
  exec_db pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    --no-owner --no-privileges --no-acl \
    --quoteIdentifiers --inserts --column-inserts \
    --format=plain > "${output_file}" || {
    error "Не удалось экспортировать базу данных"
    return 1
  }

  log "Экспорт базы данных завершён: ${output_file} ($(du -h "${output_file}" | cut -d' ' -f1))"
  echo "${output_file}"
}

# Экспорт только данных (INSERT-операторы) для импорта с дедубликацией
export_data_only() {
  local output_file="${1:-${TMP_DIR}/db-data_$(date +%Y%m%d_%H%M%S).sql}"
  local temp_db="temp_export_$(date +%s)"

  log "Начинаю экспорт только данных в ${output_file}"

  # Создание временной базы данных для экспорта данных
  exec_db createdb -E utf8 "${temp_db}" || {
    error "Не удалось создать временную базу данных: ${temp_db}"
    return 1
  }

  # Копирование всех таблиц в временную базу данных
  local failed_tables=""
  local tables=$(list_tables)

  echo "${tables}" | while read -r table; do
    log "Экспортирую данные таблицы: ${table}"
    exec_db pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${temp_db}" \
      --column-inserts --inserts --quoteIdentifiers \
      --table="${table}" >> "${output_file}" || {
      error "Не удалось экспортировать данные таблицы: ${table}"
      failed_tables="${failed_tables} ${table}"
    }
  done

  # Удаление временной базы данных
  exec_db dropdb "${temp_db}" || {
    error "Не удалось удалить временную базу данных: ${temp_db}"
    return 1
  }

  if [[ -n "${failed_tables}" ]]; then
    error "Не удалось экспортировать данные таблиц:${failed_tables}"
    return 1
  fi

  log "Экспорт данных завершён: ${output_file} ($(du -h "${output_file}" | cut -d' ' -f1))"
  echo "${output_file}"
}

# Экспорт аналитических данных (агрегированных таблиц)
export_analytics() {
  local output_file="${1:-${TMP_DIR}/db-analytics_$(date +%Y%m%d_%H%M%S).sql}"
  local analytics_tables="ObSnapshotRollup ObRollupBucket ObBigTrade ObTrade ObSnapshotFootprint"

  log "Начинаю экспорт аналитических таблиц в ${output_file}"

  local failed_tables=""

  for table in ${analytics_tables}; do
    log "Экспортирую аналитическую таблицу: ${table}"
    exec_db pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
      --column-inserts --inserts --quoteIdentifiers \
      --table="${table}" >> "${output_file}" || {
      error "Не удалось экспортировать аналитическую таблицу: ${table}"
      failed_tables="${failed_tables} ${table}"
    }
  done

  if [[ -n "${failed_tables}" ]]; then
    error "Не удалось экспортировать аналитические таблицы:${failed_tables}"
    return 1
  fi

  log "Экспорт аналитических таблиц завершён: ${output_file} ($(du -h "${output_file}" | cut -d' ' -f1))"
  echo "${output_file}"
}

# Функция для добавления ON CONFLICT DO NOTHING к INSERT-командам
process_inserts_for_dedup() {
  local input_file="$1"
  local output_file="$2"

  # Создаём обработанную версию со вставками с дедубликацией
  awk 'BEGIN { in_insert = 0; buffer = ""; paren_count = 0; }
    {
      line = $0;

      # Обнаружение начала INSERT-команды
      if (!in_insert && line ~ /^INSERT INTO [^ ]+ \(/) {
        in_insert = 1;
        buffer = line;
        next;
      }

      if (in_insert) {
        buffer = buffer "\n" line;

        # Учет скобок для обнаружения конца INSERT
        for (i = 1; i <= length(line); i++) {
          char = substr(line, i, 1);
          if (char == "(") paren_count++;
          else if (char == ")") paren_count--;
        }

        # Обнаружение конца INSERT при paren_count = 0 и presence of semicolon
        if (paren_count == 0 && line ~ /;[[:space:]]*$/) {
          # Добавляем ON CONFLICT DO NOTHING перед последним точкой с запятой
          sub(/;[[:space:]]*$/, " ON CONFLICT DO NOTHING;", buffer);
          print buffer;
          in_insert = 0;
          buffer = "";
          paren_count = 0;
          next;
        }
      }

      # Пропуск COPY-команд (они не поддерживают дедубликацию в bash)
      if (line ~ /^COPY /) {
        next;
      }

      # Пропускаем CREATE/ALTER/DROP команды (обрабатываются отдельно)
      if (line ~ /^(CREATE |ALTER |DROP |GRANT |REVOKE )/) {
        next;
      }

      # Пропускаем пустые строки
      if (line ~ /^[[:space:]]*$/) {
        next;
      }

      # Пропускаем комментарии
      if (line ~ /^--/) {
        next;
      }

      # Пропускаем SET-команды
      if (line ~ /^SET /) {
        next;
      }

      # Всё остальное пропускаем (пропускаем блоки DDL)
      print line;
    }
    END {
      if (in_insert) {
        print buffer;
      }
    }' "$input_file" > "${output_file}"

  log "Обработан дамп для дедубликации: ${input_file} -> ${output_file}"
}

# Функция импорта данных с дедубликацией
import_with_dedup() {
  local input_file="$1"
  local temp_dedup_file="${TMP_DIR}/dedup_$(date +%s).sql"

  if [[ ! -f "${input_file}" ]]; then
    error "Входной файл не найден: ${input_file}"
    return 1
  fi

  log "Начинаю импорт данных с дедубликацией: ${input_file}"

  # Очистка существующих аналитических таблиц
  local analytics_tables="ObSnapshotRollup ObRollupBucket ObBigTrade ObTrade ObSnapshotFootprint"
  local cleanup_failed=""

  for table in ${analytics_tables}; do
    if run_psql -c "TRUNCATE TABLE \"${table}\" CASCADE;" >> "${LOG_FILE}" 2>&1; then
      log "Таблица ${table} успешно очищена"
    else
      log "Предупреждение: не удалось очистить таблицу ${table}"
      cleanup_failed="${cleanup_failed} ${table}"
    fi
  done

  if [[ -n "${cleanup_failed}" ]]; then
    error "Не удалось очистить таблицы:${cleanup_failed}"
    return 1
  fi

  # Обработка файла для добавления ON CONFLICT DO NOTHING
  process_inserts_for_dedup "${input_file}" "${temp_dedup_file}"

  # Выполнение импорта данных с дедубликацией
  log "Выполнение импорта данных с дедубликацией..."

  # Сначала создаём временную таблицу
  local temp_table="tmp_import_${RANDOM}"
  run_psql <<SQL >> "${LOG_FILE}" 2>&1
CREATE TEMPORARY TABLE "${temp_table}" AS
SELECT * FROM Trades
WITH NO DATA;
SQL

  # Импортируем данные во временную таблицу (только INSERT-операторы)
  if exec_db pg_restore -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}"
    -d "${DB_NAME}" --no-owner --no-privileges --no-acl
    --table="${temp_table}" -f "${temp_dedup_file}" >> "${LOG_FILE}" 2>&1; then
    log "Данные успешно импортированы во временную таблицу: ${temp_table}"
  else
    error "Не удалось импортировать данные во временную таблицу"
    run_psql -c "DROP TABLE IF EXISTS \"${temp_table}\" CASCADE;"
    return 1
  fi

  # Транзакция с дедубликацией
  log "Выполняется транзакция с дедубликацией..."
  run_psql <<SQL >> "${LOG_FILE}" 2>&1
BEGIN;

-- Основная таблица Trades с дедубликацией
INSERT INTO Trades
SELECT * FROM "${temp_table}"
ON CONFLICT (id) DO NOTHING;

-- Аналитические таблицы (дедубликация по соответствующим столбцам)
INSERT INTO ObSnapshotRollup
SELECT * FROM "${temp_table}_ObSnapshotRollup"
ON CONFLICT (trade_id, time_bucket) DO NOTHING;

INSERT INTO ObRollupBucket
SELECT * FROM "${temp_table}_ObRollupBucket"
ON CONFLICT (time_bucket, symbol) DO NOTHING;

INSERT INTO ObBigTrade
SELECT * FROM "${temp_table}_ObBigTrade"
ON CONFLICT (trade_id, timestamp) DO NOTHING;

INSERT INTO ObTrade
SELECT * FROM "${temp_table}_ObTrade"
ON CONFLICT (trade_id, timestamp) DO NOTHING;

INSERT INTO ObSnapshotFootprint
SELECT * FROM "${temp_table}_ObSnapshotFootprint"
ON CONFLICT (trade_id, timestamp) DO NOTHING;

COMMIT;
SQL

  # Удаление временной таблицы
  run_psql -c "DROP TABLE IF EXISTS \"${temp_table}\" CASCADE;"

  # Удаление временного файла
  rm -f "${temp_dedup_file}"

  log "Импорт данных с дедубликацией успешно завершён"
}

# Функция импорта с полной заменой (TRUNCATE + import)
import_clean() {
  local input_file="$1"

  if [[ ! -f "${input_file}" ]]; then
    error "Входной файл не найден: ${input_file}"
    return 1
  fi

  log "Начинаю импорт с полной заменой: ${input_file}"

  # Остановка всех连接到 базе данных
  log "Отключение всех соединений к базе данных..."
  run_psql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}';"

  # Удаление существующей базы данных и создание новой
  if exec_db dropdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" "${DB_NAME}"; then
    log "Старая база данных удалена"
  else
    error "Не удалось удалить старую базу данных"
    return 1
  fi

  exec_db createdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" "${DB_NAME}" || {
    error "Не удалось создать новую базу данных"
    return 1
  }

  # Восстановление полной базы данных с помощью pg_restore
  log "Восстановление полной базы данных..."

  if exec_db pg_restore -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}"
    -d "${DB_NAME}"
    -Fc -j 4 --no-owner --no-privileges --no-acl \
    --input-recovery \
    -f "${input_file}" >> "${LOG_FILE}" 2>&1; then
    log "Восстановление базы данных успешно завершено"
  else
    error "Не удалось восстановить базу данных с помощью pg_restore"
    return 1
  fi

  log "Импорт с полной заменой успешно завершён"
}

# Функция создания базового дампа (DDL + данные)
create_basic_dump() {
  local output_file="${1:-${TMP_DIR}/basic_dump_$(date +%Y%m%d_%H%M%S).sql}"

  log "Начинаю создание базового дампа (только CREATE/INSERT)..."

  # Получение списка таблиц
  local tables=$(list_tables)
  local first_table="true"

  for table in ${tables}; do
    log "Создание дампа таблицы: ${table}"

    # Экспорт DDL таблицы
    exec_db pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
      --format=plain --schema-only --no-owner --no-privileges \
      --table="${table}" >> "${output_file}" || {
      error "Не удалось экспортировать DDL таблицы: ${table}"
      return 1
    }

    # Экспорт данных таблицы
    exec_db pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
      --column-inserts --inserts --quoteIdentifiers \
      --table="${table}" >> "${output_file}" || {
      error "Не удалось экспортировать данные таблицы: ${table}"
      return 1
    }
  done

  log "Базовый дамп успешно создан: ${output_file}"
  echo "${output_file}"
}

# Предоставление справочной информации
function show_help() {
  cat <<EOF
=== TradingStats Database Backup Functions ===

Команды:
  export_full                Экспорт всей базы данных (схема + данные)
  export_data_only [output]  Экспорт только INSERT-операторов (для дедубликации)
  export_analytics [output]  Экспорт аналитических таблиц
  import_with_dedup <file>   Импорт с дедубликацией (ON CONFLICT DO NOTHING)
  import_clean <file>        Импорт с полной заменой (TRUNCATE + import)
  create_basic_dump [output] Создание базового дампа (DDL + INSERT)
  show_help                  Показать эту справочную информацию

Использование:
  # Экспорт всей базы данных
  db-backup-functions.sh export_full

  # Экспорт только данных
  db-backup-functions.sh export_data_only

  # Экспорт аналитических таблиц
  db-backup-functions.sh export_analytics

  # Импорт с дедубликацией
  db-backup-functions.sh import_with_dedup data_dump.sql

  # Импорт с полной заменой
  db-backup-functions.sh import_clean full_dump.sql

  # Создание базового дампа
  db-backup-functions.sh create_basic_dump

Файлы:
  db-backup-functions.log  - Журнал работы
  tmp/                     - Временные файлы

EOF
  exit 0
}

# ──────────────────────────────────────────────────────────────────────
# ОБРАБОТЧИК КОМАНД
# ──────────────────────────────────────────────────────────────────────

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  case "${1:-}" in
    export_full)
      export_full "${2:-}"
      ;;
    export_data_only)
      export_data_only "${2:-}"
      ;;
    export_analytics)
      export_analytics "${2:-}"
      ;;
    import_with_dedup)
      load_env
      check_env
      parse_db_url
      check_db_connection
      import_with_dedup "${1}"
      ;;
    import_clean)
      load_env
      check_env
      parse_db_url
      check_db_connection
      import_clean "${1}"
      ;;
    create_basic_dump)
      load_env
      check_env
      parse_db_url
      check_db_connection
      create_basic_dump "${2:-}"
      ;;
    help|"*")
      show_help
      ;;
    *)
      echo "Неизвестная команда: ${1:-}"
      show_help
      ;;
  esac
fi

EOF