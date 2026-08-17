# План: Добавление форекс-графика с индикаторами (карта ордеров для форекс)

## ⚠️ Проблема

Криптобиржи (Binance, Bybit, OKX) публично отдают **полный стакан (Level 2)** через WebSocket
бесплатно. Форекс так не работает — там нет единой биржи. Рынок децентрализован (банки, ECN,
брокеры), и настоящий межбанковский стакан (EBS, Cboe FX) стоит тысячи $/мес.

**Решение:** Использовать бесплатный REST API для OHLCV свечей.
Twelve Data (https://twelvedata.com) — 800 запросов/день бесплатно.

---

## 📡 Источники данных — сравнение

### ~~🥇 Dukascopy JForex API (БЫЛО РЕКОМЕНДОВАНО)~~
| Параметр | Значение |
|---|---|
| Глубина стакана | **10 уровней** (bid/ask с объёмами) |
| Стоимость | **Бесплатно** с демо-счётом |
| **Проблема** | ❌ **Не доступен из РБ** (Dukascopy блокирует регион) |

**➡️ Заменён на Twelve Data REST API (см. ниже)**

### 🥇 Twelve Data (текущий источник)
| Параметр | Значение |
|---|---|
| Тип данных | **OHLCV свечи** (без стакана) |
| Стоимость | **Бесплатно** (800 запросов/день, 8 запросов/мин) |
| Пары | Все мажоры + кроссы |
| Протокол | REST API (HTTP) |
| Realtime | ✅ Через периодический polling |
| Доступность из РБ | ✅ Чистый HTTP, без блокировок |
| Стакан (depth) | ❌ Нет данных стакана |

**Схема подключения:**
```
Twelve Data REST API → forex-collector → Postgres (FxCandle)
```

### 🟢 AllTick (резервный)
- 5-уровневый стакан через WebSocket
- ~50 пар, есть бесплатный tier
- Лимит: 10 запросов/мин на бесплатном

### 🟡 TrueFX
- 3 уровня depth of book
- Бесплатно (регистрация)
- 16+ мажоров, FIX/HTTP

### 🔵 iTick (платный)
- Полный multi-level стакан
- REST + WebSocket + Python SDK
- Мажоры + кроссы

---

## ⚠️ Ограничения Twelve Data (free tier)

Twelve Data даёт **только OHLCV свечи**, без глубины стакана и без bid/ask котировок.
Индикаторы работают через **аппроксимацию из свечей**:

| Компонент | В orderflow | В forex | Как работает |
|---|---|---|---|
| Свечной график (canvas) | ✅ | ✅ | Из OHLCV |
| Volume Profile | ✅ | ✅ (приблизительно) | Распределение объёма из свечей |
| Delta / CVD | ✅ | ✅ (аппроксимация) | close > open ? +volume : -volume |
| B/A Spread | ✅ | ✅ (аппроксимация) | bid ≈ low, ask ≈ high из свечи |
| ImbalanceHeatmap | ✅ | ✅ (аппроксимация) | Отношение объёма бычьих/медвежьих свечей |
| Absorption Panel | ✅ | ✅ (из свечей) | Аномалии объёма (> 2.5x от MA) |
| Divergence History | ✅ | ✅ (из свечей) | Цена делает HH/LL, объём падает |
| Big trades table | ✅ | ❌ | Требует ticks |
| Speed of Tape | ✅ | ❌ | Требует ticks |

**Примечание:** Twelve Data free tier **не отдаёт bid/ask** в quote endpoint.
Таблица `FxQuote` создана в БД для будущего использования (при переходе на платный тариф
или другой источник данных с bid/ask).

---

## 🧱 Архитектура решения

### Структура навигации

```
Нав-меню:
  Карта ликвидаций  → /dashboard/liqmap
  Карта ордеров     → /dashboard/orderflow
  Форекс            → /dashboard/forex          ← НОВЫЙ ПУНКТ
```

### Структура страницы `/dashboard/forex`

```
┌─────────────────────────────────────────────────┐
│  Заголовок + селекты (пара, таймфрейм)          │
├─────────────────────────────────────────────────┤
│                                                 │
│  Canvas: свечной график (как в orderflow,       │
│          но БЕЗ heatmap-стен)                   │
│          + перекрестие + тултип                 │
│                                                 │
├─────────────────────────────────────────────────┤
│  Delta / CVD (аппроксимация из свечей)            │
├─────────────────────────────────────────────────┤
│  B/A Spread (аппроксимация low/high из свечей)    │
├─────────────────────────────────────────────────┤
│  Volume Profile (из свечей)                     │
├─────────────────────────────────────────────────┤
│  Bid/Ask Imbalance (из свечей)                  │
├─────────────────────────────────────────────────┤
│  Absorption Panel (аномалии объёма из свечей)   │
├─────────────────────────────────────────────────┤
│  Divergence History (price/volume из свечей)    │
└─────────────────────────────────────────────────┘
```

---

## 📋 План реализации — по шагам

### Статусы задач:
- `[ ]` — НЕ ВЫПОЛНЕННО
- `[x]` — ВЫПОЛНЕННО
- `[~]` — ЗАМЕНЕНО/ОТЛОЖЕНО

---

### Фаза 1: Данные (collector)

#### 1.1 Инфраструктура Dukascopy bridge → **ЗАМЕНЕНО на Twelve Data**
- [x] Создать `collector/forex/` — директория для форекс-модуля
- [x] Изучить Twelve Data API (альтернатива Dukascopy, недоступного из РБ)
- [x] ~~Добавить сервис `dukascopy-bridge` в `docker-compose.prod.yml`~~ → **Удалён**, заменён на прямой API
- [x] Настроить на мажоры: EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, NZD/USD, EUR/JPY, GBP/JPY
- [x] Создать конфиг `.env.forex` → **Twelve Data API key** в `.env` через `TWELVEDATA_API_KEY`

#### 1.2 Модели данных (Prisma)
- [x] Создать модель `FxCandle` — свечи для форекс
- [x] Создать модель `FxDepthSnapshot` → `FxDepth` (оставлена для совместимости, не используется)
- [x] Создать rollup-таблицы для Fx: `FxDepthRollup`, `FxRollupBucket` (оставлены, не используются)
- [~] Создать модель `FxTick` — отложено: Twelve Data не даёт тики
- [~] Создать модель `FxImbalance` — отложено: нет depth
- [~] Создать модель `FxAbsorption` — отложено: нет depth
- [~] Создать модель `FxDivergence` — отложено: нет depth
- [x] Применить миграции: `prisma/migrations/20260729000001_add_forex_tables/migration.sql`

#### 1.3 Модуль коллектора для форекс
- [x] Создать `collector/forex/index.mjs` — **переписан: Twelve Data REST API вместо Dukascopy bridge**
  - [x] Бэкафилл исторических данных при старте
  - [x] Периодическое обновление свечей (каждые 5 мин)
  - [x] Rate limiter для free tier (8 запросов/мин)
  - [x] Healthcheck endpoint
  - [x] Чистка старых данных
- [x] Создать `Dockerfile.forex-collector` в корне
- [x] Добавить сервис `forex-collector` в `docker-compose.prod.yml`
- [x] Обновить `.github/workflows/deploy.yml` — добавить сборку и пуш `forex-collector`
- [x] Сделать тестовый запуск, проверить запись в БД

---

### Фаза 2: API (Next.js backend)

#### 2.1 API роут `/api/forex`
- [x] Создать `src/app/api/forex/route.ts` — основной эндпоинт:
  - [x] Параметры: `symbol`, `range`, `tz`
  - [x] Возвращает: candles[], timeline
  - [x] delta — аппроксимация из свечей (±volume по направлению)
  - [x] ba — аппроксимация из свечей (bid=low, ask=high)
- [x] Поддержать fallback для нераспознанного timezone (как в orderflow)

#### 2.2 API роут `/api/forex/imbalance`
- [x] Создать `src/app/api/forex/imbalance/route.ts`
- [x] **Переписан: отношение объёма бычьих/медвежьих свечей**

#### 2.3 API роут `/api/forex/volume-profile`
- [x] Создать `src/app/api/forex/volume-profile/route.ts`
- [x] **Переписан: распределение объёма из FxCandle (без depth)**
- [x] Параметры: `symbol`, `period`
- [x] Возвращает: `{ volumeProfile: VolumeProfile }` (приблизительный)

#### 2.4 API роут `/api/forex/absorption`
- [x] Создать `src/app/api/forex/absorption/route.ts`
- [x] **Переписан: аномалии объёма свечей (> 2.5x MA)**

#### 2.5 API роут `/api/forex/divergence`
- [x] Создать `src/app/api/forex/divergence/route.ts`
- [x] **Переписан: price/volume divergence из свечей**

#### 2.6 API роут `/api/forex/meta`
- [x] Создать `src/app/api/forex/meta/route.ts`
- [x] Возвращает список доступных валютных пар

---

### Фаза 3: UI (Frontend)

#### 3.1 Навигация
- [x] Добавить в `src/components/DashboardNav.tsx` пункт "Forex" / "Форекс":
  - [x] Иконка: `TrendingUp`
  - [x] Ссылка: `/dashboard/forex`
  - [x] Разместить между "Карта ликвидаций" и "Карта ордеров"
- [x] Добавить в i18n ключи:
  - [x] `"nav.forex": "Forex"` (EN)
  - [x] `"nav.forex": "Форекс"` (RU)

#### 3.2 Страница `/dashboard/forex`
- [x] Создать `src/app/dashboard/forex/page.tsx`
  - [x] Свечной график на canvas
  - [x] Delta/CVD canvas (аппроксимация из свечей)
  - [x] B/A spread canvas (аппроксимация low/high из свечей)
  - [x] Селектор валютных пар (из /api/forex/meta)
  - [x] Селектор таймфрейма
  - [x] VolumeProfile (из свечей)
  - [x] ImbalanceHeatmap (из свечей — объёмный дисбаланс)
  - [x] AbsorptionPanel (аномалии объёма из свечей)
  - [x] DivergenceHistory (price/volume из свечей)

#### 3.3 Адаптация общих компонентов
- [x] Проверить `ImbalanceHeatmap.tsx` — работает с пустыми данными
- [x] Проверить `VolumeProfile.tsx` — работает с пустыми данными
- [x] Проверить `AbsorptionPanel.tsx` — работает с пустыми данными
- [x] Проверить `DivergenceHistory.tsx` — работает с пустыми данными

#### 3.4 i18n — новые ключи
Добавить в `src/lib/i18n/dictionaries.ts`:
- [x] `"fx.title": "Forex"` / `"Форекс"`
- [x] `"fx.subtitle": "Live forex candlestick chart with indicators (candles from Twelve Data)."` / `"Живой график форекс с индикаторами (свечи из Twelve Data)."`
- [x] `"fx.empty": "No data yet — the collector is fetching candles from Twelve Data."` / `"Данных пока нет — коллектор загружает свечи из Twelve Data."`
- [x] `"fx.hintSymbol": "Forex pair to display."` / `"Валютная пара для отображения."`
- [x] `"fx.hintTimeframe": "Candle timeframe."` / `"Таймфрейм свечей."`
- [x] `"fx.noDelta": "No data yet — the collector is still fetching candles from Twelve Data"` / `"Нет данных — коллектор ещё загружает свечи из Twelve Data"`
- [x] `"fx.noBa": "No data yet — the collector is still fetching candles from Twelve Data"` / `"Нет данных — коллектор ещё загружает свечи из Twelve Data"`

---

### Фаза 4: Тестирование и деплой

#### 4.1 Локальное тестирование
- [x] Получить API ключ Twelve Data: https://twelvedata.com/apikey (бесплатно)
- [x] Запустить `forex-collector` локально и проверить запись в Postgres
- [x] Проверить отображение свечей через API (401 — требуется авторизация)
- [x] Проверить Volume Profile API
- [x] Проверить все индикаторы (Delta, B/A, Imbalance, Absorption, Divergence)
- [x] Переключить язык на русский — проверить переводы

#### 4.2 TypeScript / сборка
- [x] `npx tsc --noEmit` — ошибок по forex нет
- [x] Собрать Docker-образ `forex-collector`
- [x] Протестировать образ локально (docker compose up -d)

#### 4.3 Деплой
- [x] Обновить `.github/workflows/deploy.yml` — добавить сборку и пуш `forex-collector`
- [x] Обновить `docker-compose.prod.yml` на сервере (через git pull)
- [ ] Запустить на сервере: `docker compose -f docker-compose.prod.yml up -d`
- [ ] Добавить `TWELVEDATA_API_KEY` в .env на сервере
- [ ] Проверить watchtower подхватывает новые образы

---

## 🔗 Полезные ссылки

- Twelve Data API: https://twelvedata.com/docs
- Twelve Data API key (бесплатно): https://twelvedata.com/apikey
- TrueFX: https://www.truefx.com
- AllTick: https://alltick.co
- iTick Forex Depth API: https://docs.itick.io/en/rest-api/forex/forex-depths
- OANDA v20 API: https://developer.oanda.com/