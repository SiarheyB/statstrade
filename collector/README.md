# TradeStats Collector — orderbook heatmap

Постоянный сервис: поддерживает локальные стаканы бирж по WebSocket и пишет
агрегированные снапшоты в Postgres (таблица `ObSnapshot`), которые фронт
рисует как тепловую карту лимитных ордеров (`/dashboard/orderflow`).

> ⚠️ Это **long-running** процесс с постоянным WebSocket — его НЕЛЬЗЯ деплоить на
> Vercel (serverless). Нужна платформа с постоянными контейнерами:
> Railway / Fly.io / Render / собственный VPS (позже — домашний сервер).

## Что собирает
- Биржи: `binance-futures`, `bybit-futures`, `okx-futures` (USDⓈ-M перпы).
- На каждую пару (биржа × символ) — отдельный стакан с корректной синхронизацией
  (Binance: snapshot+diff с контролем sequence и ресинком; Bybit: snapshot+delta;
  OKX: books с контролем seqId).
- Раз в `SNAPSHOT_MS` бинует уровни в пределах ±`DEPTH_PCT` от mid, отбрасывает
  шум по нотионалу и пишет строки `(symbol, exchange, t, price, bidVol, askVol)`.
- Раз в час удаляет данные старше `RETENTION_DAYS`.

## Конфиг (ENV)
См. `.env.example`. Основное:
| Переменная | Дефолт | Назначение |
|---|---|---|
| `DATABASE_URL` | — | Postgres (та же база, что у Next.js: сейчас Neon, позже домашний сервер) |
| `SYMBOLS` | `BTCUSDT` | список через запятую, напр. `BTCUSDT,ETHUSDT` |
| `EXCHANGES` | `binance-futures` | напр. `binance-futures,bybit-futures,okx-futures` |
| `BIN_SIZE` | `25` | ширина ценового бина, $ (для BTC) |
| `BIN_SIZE_<SYMBOL>` | — | переопределение шага для символа, напр. `BIN_SIZE_ETHUSDT=1` |
| `SNAPSHOT_MS` | `2000` | период записи снапшота |
| `DEPTH_PCT` | `0.02` | глубина вокруг mid (±2%) |
| `NOISE_MIN_NOTIONAL` | `50000` | фильтр шума (минимальный нотионал бина, $) |
| `RETENTION_DAYS` | `7` | срок хранения истории |
| `PORT` | `8080` | HTTP healthcheck (`/health`) |

## Локальный запуск
```bash
cd collector
npm install
DATABASE_URL=postgres://tradestats:tradestats@localhost:5432/tradestats \
  SYMBOLS=BTCUSDT EXCHANGES=binance-futures,bybit-futures,okx-futures \
  npm start
# healthcheck: curl localhost:8080/health
```

## Деплой (пример Railway)
1. Создать сервис из этой папки (`collector/`) — Railway подхватит `Dockerfile`.
2. Задать переменные окружения (минимум `DATABASE_URL` = строка Neon/прод-БД).
3. Healthcheck path: `/health`, порт `8080`.
4. Таблица `ObSnapshot` создаётся миграцией основного приложения
   (`prisma migrate deploy` при деплое Next.js) — отдельной миграции не нужно.

## Замечания по данным
- **Binance** отдаёт ~1000 уровней → покрывает весь ±2% диапазон (самый «богатый»).
- **Bybit** (linear) — максимум 200 уровней WS → узкая полоса у цены.
- **OKX** (`books`, 400 уровней) — размер в контрактах, приводится к базовым
  единицам по `ctVal` (карта в `okx.mjs`; добавить символы при необходимости).
- Объём БД при `SNAPSHOT_MS=2000` и нескольких биржах растёт быстро — следить за
  `RETENTION_DAYS` и `NOISE_MIN_NOTIONAL`.
