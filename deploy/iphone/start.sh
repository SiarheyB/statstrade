#!/bin/sh
# Запуск/восстановление сервисов на iPhone (iSH) через pm2.
# Держит приложение(я) и Cloudflare-туннель живыми, перезапускает упавшие и
# восстанавливает всё после перезапуска iSH/телефона.
# Запускать после открытия iSH (и после перезагрузки телефона):
#   sh ~/tradestats/deploy/iphone/start.sh

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

# Имя именованного туннеля Cloudflare (см. README, шаг 6). Можно переопределить:
#   TUNNEL_NAME=mytunnel sh start.sh
TUNNEL_NAME="${TUNNEL_NAME:-tradestats}"

# Восстановить ранее сохранённые сервисы (все приложения + туннель).
pm2 resurrect 2>/dev/null || true

# Поднять основное приложение, если его ещё нет (продакшн-сборка или dev как запас).
if ! pm2 describe tradestats >/dev/null 2>&1; then
  if [ -f .next/BUILD_ID ]; then
    pm2 start npm --name tradestats -- start
  else
    echo "[app] .next не найден — запуск в dev-режиме"
    pm2 start npm --name tradestats -- run dev
  fi
fi

# Поднять туннель, если его ещё нет.
pm2 describe tunnel >/dev/null 2>&1 || \
  pm2 start cloudflared --name tunnel -- tunnel run "$TUNNEL_NAME"

pm2 save
pm2 status

echo ""
echo "Логи:           pm2 logs"
echo "Перезапуск:     pm2 restart tradestats"
echo "2-е приложение: cd ~/другой-проект && PORT=3001 pm2 start npm --name app2 -- start && pm2 save"
