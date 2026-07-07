# Production-образ Next.js приложения (TradeStats).
# Собирается в CI (GitHub Actions) и пушится в GHCR — мини-сервер только запускает.
FROM node:24-slim

WORKDIR /app

# Prisma требует openssl в slim-образе.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Зависимости (postinstall = prisma generate, поэтому схема нужна до npm ci).
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm install

# Исходники + сборка. NEXT_PUBLIC_* встраивается на этапе сборки, поэтому
# Google Client ID (опционально) передаётся build-арг'ом из CI.
COPY . .
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=""
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
# Cloudflare Turnstile site key (публичный, капча на регистрации). Пусто — выключена.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
# Собираем БЕЗ `npm run build` (там есть migrate deploy, который требует БД).
RUN npx prisma generate && npx next build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Копируем и делаем исполняемым наш entrypoint-скрипт (авто-фикс миграций).
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# В рантайме: entrypoint проверяет/чинит застрявшие миграции,
# затем применяет остальные и стартует сервер.
CMD ["/app/docker-entrypoint.sh"]
