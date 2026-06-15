#!/bin/sh
# Разовая настройка приложения для запуска как сервера на iPhone (iSH / Alpine).
# База данных — облачная (Neon). Запускать ИЗНУТРИ iSH, после `git clone`:
#   sh ~/tradestats/deploy/iphone/setup.sh
# Идемпотентный — можно запускать повторно.
set -e

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

echo "==> Установка пакетов (Alpine)…"
apk add nodejs npm git openssl nano wget

echo "==> Менеджер процессов pm2…"
command -v pm2 >/dev/null 2>&1 || npm install -g pm2

echo "==> Проверка cloudflared…"
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "    Скачиваю cloudflared (сборка linux-386 для iSH)…"
  wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-386 \
    -O /usr/local/bin/cloudflared
  chmod +x /usr/local/bin/cloudflared
fi

# --- .env ---
NEW_ENV=0
if [ ! -f .env ]; then
  cp .env.example .env
  NEW_ENV=1
fi

echo "==> Генерация секретов в .env (только для пустых/placeholder-значений)…"
node - <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
let env = fs.readFileSync('.env', 'utf8');
const ensure = (key, gen) => {
  const re = new RegExp(`^${key}=(.*)$`, 'm');
  const m = env.match(re);
  const cur = m ? m[1].replace(/^["']|["']$/g, '').trim() : '';
  if (!cur || cur.startsWith('change-me')) {
    const line = `${key}="${gen()}"`;
    env = m ? env.replace(re, line) : env + `\n${line}`;
  }
};
ensure('JWT_SECRET', () => crypto.randomBytes(48).toString('hex'));
ensure('ENCRYPTION_KEY', () => crypto.randomBytes(32).toString('hex'));
ensure('CRON_SECRET', () => crypto.randomBytes(24).toString('hex'));
fs.writeFileSync('.env', env);
NODE

if [ "$NEW_ENV" = "1" ]; then
  echo ""
  echo "!!  Файл .env создан, секреты сгенерированы."
  echo "!!  Теперь впиши строку подключения из neon.tech в DATABASE_URL:"
  echo "!!      nano .env"
  echo "!!  Затем запусти этот скрипт снова:"
  echo "!!      sh deploy/iphone/setup.sh"
  exit 0
fi

echo "==> Установка зависимостей (npm install — на эмуляции долго)…"
npm install

echo "==> Применение миграций БД…"
npx prisma migrate deploy
npx prisma generate

echo "==> Сборка приложения (npm run build — на эмуляции долго)…"
if ! npm run build; then
  echo ""
  echo "!!  Сборка не удалась (вероятно, не хватило памяти под эмуляцией)."
  echo "!!  start.sh запустится в dev-режиме как запасной вариант,"
  echo "!!  либо собери проект на компьютере и скопируй сюда папку .next."
fi

echo ""
echo "==> Готово. Запуск сервера:"
echo "    sh $REPO/deploy/iphone/start.sh   # приложение + туннель (pm2)"
echo "    pm2 status                        # что запущено"
echo "    pm2 logs                          # логи"
echo ""
echo "    Перед запуском настрой туннель Cloudflare (README → «Сервер из iPhone», шаг 6)"
echo "    и включи Гид-доступ + Автоблокировку «Никогда»."
