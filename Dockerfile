# Production-образ Next.js приложения (TradeStats).
# Собирается в CI (GitHub Actions) и пушится в GHCR — мини-сервер только тянет
# готовый образ, поэтому его размер = время выката через watchtower.
#
# Сборка двухстадийная: в финальный образ не попадают dev-зависимости
# (19 пакетов, среди них vitest/eslint/tailwind-тулинг), кэш сборки
# (.next/cache, ~200 МБ) и исходники — `next start` работает с готовым .next.

# ─── Стадия 1: сборка ────────────────────────────────────────────────────
FROM node:24-slim AS builder

WORKDIR /app

# Prisma требует openssl даже на этапе генерации клиента.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Зависимости (postinstall = prisma generate, поэтому схема нужна до установки).
# npm ci вместо npm install: ставит РОВНО то, что в lockfile, и падает при
# рассинхроне вместо того, чтобы молча его править.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# Исходники + сборка. NEXT_PUBLIC_* встраивается на этапе сборки, поэтому
# Google Client ID (опционально) передаётся build-арг'ом из CI.
COPY . .
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=""
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
# Cloudflare Turnstile site key (публичный, капча на регистрации). Пусто — выключена.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
# Собираем БЕЗ `npm run build` (там есть migrate deploy, который требует БД).
RUN npx prisma generate && npx next build \
  && rm -rf .next/cache

# ─── Стадия 2: рантайм ───────────────────────────────────────────────────
FROM node:24-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# openssl — для Prisma; psql — для авто-фикса миграций в docker-entrypoint.sh.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/*

# Только прод-зависимости. prisma CLI лежит в dependencies осознанно: контейнер
# выполняет `prisma migrate deploy` при каждом старте (см. docker-entrypoint.sh),
# то есть это рантайм-инструмент, а не инструмент разработки.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev \
  && npx prisma generate \
  && npm cache clean --force

# Готовая сборка. Исходники (src/) не нужны: next start запускает .next.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3000

# В рантайме: entrypoint проверяет/чинит застрявшие миграции,
# затем применяет остальные и стартует сервер.
# Git-коммит, из которого собран этот образ — для индикатора "актуальная версия
# развёрнута" в админке (сверяется с последним коммитом main на GitHub, без
# доступа к docker.sock, см. /api/admin/deploy-status). Не NEXT_PUBLIC — читается
# только на сервере, не должен попадать в клиентский бандл.
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA

# Копируем и делаем исполняемым наш entrypoint-скрипт (авто-фикс миграций).
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh
CMD ["/app/docker-entrypoint.sh"]
