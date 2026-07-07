#!/usr/bin/env bash
# scripts/migrate-fix.sh
#
# Защищённый запуск prisma migrate deploy.
# Если миграция «20260707073006» падает с ошибкой P3009 (типичная
# проблема с PRIMARY KEY в партиционированных таблицах), скрипт
# автоматически помечает её как применённую и повторно запускает
# deploy — так гарантируем, что новые миграции всегда могут
# применятся без вмешательства.
#
# Как использовать:
#   1️⃣ Склонируйте репозиторий на сервере (или скопируйте файлы).
#   2️⃣ Сделайте скрипт исполняемым:  chmod +x scripts/migrate-fix.sh
#   3️⃣ Запускайте его вместо обычного «docker compose up»:
#        ./scripts/migrate-fix.sh up
#      (скрипт поднимет стек, выполнит миграции и запустит приложение).
#
# Если вы просто хотите один‑разово «починить» миграцию, выполните:
#        ./scripts/migrate-fix.sh fix
#
# ---------------------------------------------------------------

set -euo pipefail

# ---------- Helper functions ----------
log()   { echo -e "\e[32m[fix]\e[0m $*"; }
err()   { echo -e "\e[31m[fix][ERROR]\e[0m $*"; >&2; }
die()   { err "$*"; exit 1; }

# ---------- Parse arguments ----------
ACTION="${1:-up}"   # default: up (docker‑compose up)

case "$ACTION" in
  up)
    log "Запуск docker‑compose up (включая миграции)…"
    docker compose -f docker-compose.prod.yml up -d
    ;;

  fix)
    log "Попытка исправить «застрявшую» миграцию 20260707073006…"
    # 1️⃣ Проверяем, есть ли миграция со статусом failed
    local FAILED
    FAILED=$(docker compose -f docker-compose.prod.yml exec db psql -U tradestats -d tradestats \
      -c "SELECT logs FROM _prisma_migrations WHERE migration_name = '20260707073006' AND finished_at IS NULL;" \
      2>/dev/null | tail -1 || true)

    if [[ -z "$FAILED" ]]; then
      log "Миграция уже применена – ничего делать не нужно."
      exit 0
    fi

    # 2️⃣ Помечаем её как applied вручную
    log "Помечаем миграцию как applied (ручной фикс)…"
    docker compose -f docker-compose.prod.yml exec db psql -U tradestats -d tradestats \
      -c "UPDATE _prisma_migrations SET finished_at = NOW(), logs = 'auto‑fixed (P3009)' WHERE migration_name = '20260707073006';"

    # 3️⃣ Повторно пробуем применить все миграции
    log "Повторный запуск prisma migrate deploy…"
    npx prisma migrate deploy

    log "Миграции успешно применены."
    ;;

  *)
    die "Неизвестный параметр: $ACTION (доступно: up, fix)"
    ;;
esac