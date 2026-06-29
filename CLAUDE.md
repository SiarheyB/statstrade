# TradeStats — заметки для Claude

## ⚠️ Деплой: домашний мини-сервер, НЕ Vercel

Проект **НЕ деплоится на Vercel**. С 2026-06-27 — **самохостинг на домашнем
мини-ПК (Debian 12)**, весь стек в Docker.

- **Стек:** `docker-compose.prod.yml` = `db` (postgres:16) + `app` (Next.js) +
  `collector` (сбор стакана) + `watchtower` (авто-обновление).
- **Сборка образов:** GitHub Actions (`.github/workflows/deploy.yml`) на **push в
  `main`** → пушит в GHCR (`ghcr.io/siarheyb/statstrade-{app,collector}`).
  Слабый сервер сам НЕ собирает — только тянет образы.
- **Авто-деплой:** `watchtower` каждые ~120с подхватывает новые образы из GHCR и
  перезапускает контейнеры. Push в `main` → через пару минут уже на сервере.
- **Миграции БД:** применяет контейнер `app` при старте — CMD
  `prisma migrate deploy` (см. `Dockerfile`). Миграции пишем вручную в
  `prisma/migrations/` (Docker локально не держим).
- **Правки `docker-compose.prod.yml` / `.env`** watchtower НЕ подхватывает — на
  сервере нужен ручной `git pull && docker compose -f docker-compose.prod.yml up -d`.
- **Публичный доступ:** Tailscale Funnel (`sudo tailscale funnel --bg 3000`).
- **Полный гайд:** `docs/SELF_HOSTING.md`.
- Репозиторий: **`SiarheyB/statstrade`**.

> Примечание: раздел «Деплой на VPS» в `README.md` — устаревший ручной вариант;
> актуальный прод — самохостинг через Docker/GHCR/watchtower выше.

## Карта ордеров (orderflow)

- `collector/` — отдельный long-running сервис: пишет снапшоты стакана, ленту
  сделок, footprint и крупные сделки в Postgres.
- **Производительность:** heatmap и B/A читают предагрегированные **rollup-таблицы**
  (`ObSnapshotRollup` / `ObRollupBucket`, минутные бакеты), которые наполняет
  коллектор, — а не миллионы сырых `ObSnapshot`. Сырые таблицы держатся коротко
  (`RAW_RETENTION_DAYS`), rollup — дольше (`ROLLUP_RETENTION_DAYS`).
