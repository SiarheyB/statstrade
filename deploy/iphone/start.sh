#!/bin/sh
# Надзор за постоянным сервером на iPhone (iSH): поднимает приложение и
# Cloudflare-туннель и автоматически перезапускает упавший процесс.
# Запускать в фоновой сессии tmux:
#   tmux new -d -s srv '~/tradestats/deploy/iphone/start.sh'
#   tmux attach -t srv      # логи (выход из просмотра: Ctrl+B, затем D)

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

# Имя именованного туннеля Cloudflare (см. README, шаг 6). Можно переопределить:
#   TUNNEL_NAME=mytunnel ./start.sh
TUNNEL_NAME="${TUNNEL_NAME:-tradestats}"

# Если на телефоне установлен локальный Postgres (Вариант B) — поднять его.
# При облачной БД (Neon) pg_ctl отсутствует, и шаг просто пропускается.
if command -v pg_ctl >/dev/null 2>&1; then
  su postgres -c "pg_ctl -D /var/lib/postgresql/data -l /tmp/pg.log start" 2>/dev/null || true
fi

# Продакшн-сборка, если есть; иначе — dev-режим как запасной вариант.
if [ -f .next/BUILD_ID ]; then
  APP_CMD="npm run start"
else
  echo "[app] .next не найден — запуск в dev-режиме (npm run dev)"
  APP_CMD="npm run dev"
fi

# Приложение с авто-перезапуском.
( while true; do
    echo "[app] старт: $APP_CMD"
    $APP_CMD
    echo "[app] остановлен, перезапуск через 3с"
    sleep 3
  done ) &

# Туннель с авто-перезапуском.
( while true; do
    echo "[tunnel] старт: cloudflared tunnel run $TUNNEL_NAME"
    cloudflared tunnel run "$TUNNEL_NAME"
    echo "[tunnel] остановлен, перезапуск через 3с"
    sleep 3
  done ) &

wait
