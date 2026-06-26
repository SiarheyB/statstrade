# Collector-сервис (orderbook heatmap). Постоянный процесс — деплоить на
# платформу с long-running контейнерами (Railway/Fly/Render/VPS), НЕ на Vercel.
FROM node:22-alpine

WORKDIR /app

# Сначала зависимости (кэш слоёв).
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Исходники collector.
COPY *.mjs ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Healthcheck дергает /health (200 если хотя бы одна книга синхронизирована).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null 2>&1 || exit 1

CMD ["node", "index.mjs"]
