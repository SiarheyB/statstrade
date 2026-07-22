# План имплементации — TradeStats

> **Дата**: 2026-07-22
> **Автор**: Аналитический отдел TradeStats
> **Статус**: ✅ Feature 1-3 завершены (→ Feature 4)
> **Стиль торговли**: уровни, пробои, ложные пробои, ложный пробой границ боковиков по тренду

---

## Содержание

1. [Общая архитектура](#1-общая-архитектура)
2. [Feature 1: Volume Profile (POC, VAL, VAH)](#2-feature-1-volume-profile-poc-val-vah)
3. [Feature 2: Divergence Scanner (цена vs дельта/CVD)](#3-feature-2-divergence-scanner-цена-vs-дельтаcvd)
4. [Feature 3: Bid/Ask Imbalance + Speed of Tape](#4-feature-3-bidask-imbalance--speed-of-tape)
5. [Feature 4: Absorption Pattern Detector](#5-feature-4-absorption-pattern-detector)
6. [Feature 5: Level-Based Annotation System](#6-feature-5-level-based-annotation-system)
7. [Feature 6: Cluster Search (поиск аномалий объёма)](#7-feature-6-cluster-search-поиск-аномалий-объёма)
8. [Карта проекта: все изменения](#8-карта-проекта-все-изменения)
9. [График выполнения](#9-график-выполнения)

---

## 1. Общая архитектура

### 1.1 Схема данных

```
┌─────────────────────────────────────────────────────────────────┐
│                        COLLECTOR                                  │
│  orderbook.mjs ──→ ObSnapshot, ObSnapshotRollup, ObRollupBucket  │
│  trades.mjs    ──→ ObTrade, ObFootprint, ObBigTrade              │
│  candles.mjs   ──→ ObCandle                                      │
└────────────────────────┬────────────────────────────────────────┘
                         │ (PostgreSQL)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     API ROUTES (Next.js)                         │
│                                                                  │
│  /api/orderflow        → heatmap, candles, delta, footprint,    │
│                          ba, bigTrades                           │
│  /api/orderflow/meta   → symbols, exchanges                     │
│  /api/orderflow/volume-profile → NEW                            │
│  /api/orderflow/divergence     → NEW                            │
│  /api/orderflow/absorption     → NEW                            │
│  /api/orderflow/imbalance      → NEW                            │
│  /api/orderflow/cluster-search → NEW                            │
└────────────────────────┬────────────────────────────────────────┘
                         │ (fetch / JSON)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   FRONTEND (React/Next.js)                       │
│                                                                  │
│  /dashboard/orderflow → heatmap + candles + delta + footprint   │
│                        + BA + bigTrades                          │
│                        + VolumeProfile   (NEW panel)             │
│                        + Divergence      (NEW overlay)           │
│                        + Imbalance        (NEW indicator)        │
│                        + Absorption      (NEW overlay)           │
│                        + ClusterSearch   (NEW panel)             │
│                        + Levels          (NEW overlay)           │
│  /dashboard/analytics → DivergenceHistory (NEW chart)            │
│  /admin/collector     → VolumeProfile config (NEW)              │
│                        → Divergence config (NEW)                │
│                        → Imbalance config (NEW)                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Принципы реализации

1. **Инкрементальность**: каждая фича реализуется независимо, имеет свой
   API-роут, компонент и тесты.
2. **Минимум миграций**: используем существующие таблицы (ObFootprint,
   ObCandle, ObSnapshot) где возможно. Новые модели — только для
   композитных данных (VolumeProfile, DivergenceResult).
3. **Перфоманс**: агрегация в Postgres (raw SQL, как в orderflow.ts), а не
   в Node.js. Новые эндпоинты кешируются (TTL 12с, как /api/orderflow).
4. **UI-паттерн**: новые панели встраиваются в существующую страницу
   orderflow как дополнительные canvas-слои или Recharts-компоненты.

---

## 2. Feature 1: Volume Profile (POC, VAL, VAH)

### 2.1 Описание

**Volume Profile** — горизонтальный профиль объёмов, показывающий
распределение торгового объёма по ценовым уровням за выбранный период.
Ключевые элементы:
- **POC (Point of Control)** — цена с максимальным объёмом (самый сильный
  уровень поддержки/сопротивления)
- **VAH (Value Area High)** — верхняя граница "зоны справедливой цены" (70%
  объёма)
- **VAL (Value Area Low)** — нижняя граница зоны
- **HVN (High Volume Node)** — зоны высокого объёма (поддержка/сопротивление)
- **LVN (Low Volume Node)** — зоны низкого объёма (цена проходит быстро)

### 2.2 Что делает для стратегии

- **Пробой уровня**: пробой POC с объёмом = истинный пробой. Пробой POC на
  падающем объёме = ложный
- **Ложный пробой границ боковика**: VAH = верхняя граница, VAL = нижняя.
  Пробой VAH на объёме → тренд. Пробой VAH без объёма → возврат в боковик
- **Уровни HVN**: цена, возвращаясь к HVN, находит поддержку/сопротивление —
  точки входа в тренд
- **LVN (gap)**: зоны, где объём мал — цена проходит их быстро. Если цена
  застревает в LVN → что-то не так, возможно накопление

### 2.3 Где размещается

| Элемент | Расположение | Компонент |
|---------|:------------:|-----------|
| Volume Profile | Правая панель на странице orderflow (рядом с profileBid/Ask) | `src/components/VolumeProfile.tsx` |
| История Volume Profile | `/dashboard/analytics` (как расширение) | `src/components/VolumeProfileHistory.tsx` |
| API | `/api/orderflow/volume-profile` | `src/app/api/orderflow/volume-profile/route.ts` |
| Библиотека | `src/lib/orderflow.ts` (новая функция) | `computeVolumeProfile()` |

### 2.4 Data Flow

```
1. Клиент запрашивает /api/orderflow/volume-profile?symbol=BTCUSDT&exchange=binance-futures&range=1h&period=24h
2. API вызывает computeVolumeProfile(symbol, exchange, fromMs, toMs)
3. computeVolumeProfile:
   a. Читает ObCandle за период (цена high/low + volume)
   b. Распределяет volume по ценовым уровням (price bins)
   c. Находит POC = уровень с максимальным volume
   d. Вычисляет VA = 70% total volume, расширяясь от POC
   e. Возвращает { poc, vah, val, levels[], totalVolume }
4. Компонент VolumeProfile рисует горизонтальный график (Recharts HorizontalBarChart или canvas)
```

### 2.5 Админка

**FeatureConfig** (ключ `volumeProfile`):
```json
{
  "enabled": true,
  "bins": 100,
  "valueAreaPct": 0.7,
  "defaultPeriod": "24h",
  "maxPeriod": "7d"
}
```

Настройки в `/admin/features`:
- Включение/отключение Volume Profile
- Количество ценовых уровней (bins) — влияет на детализацию и производительность
- Процент Value Area (по умолчанию 70%)
- Период по умолчанию (24h, 7d, 30d)
- Цветовая схема (HVN цвет, LVN цвет, POC маркер)

### 2.6 Миграции

**Не требуются** — используем существующую таблицу `ObCandle` (с новым полем
`v` для volume, которое уже есть в схеме).

### 2.7 Типы данных

```typescript
// src/lib/orderflow.ts (добавить)
export type VolumeProfileLevel = {
  price: number;       // центр бина
  volume: number;      // суммарный объём на этом уровне
  isPoc: boolean;      // true = Point of Control
  isVa: boolean;       // true = внутри Value Area
  pct: number;         // процент от maxVolume (0-100)
};

export type VolumeProfile = {
  poc: number;           // Point of Control (цена)
  vah: number;           // Value Area High
  val: number;           // Value Area Low
  levels: VolumeProfileLevel[];
  totalVolume: number;
  pocVolume: number;     // объём на POC
  valueAreaVolume: number; // объём внутри VA
  valueAreaPct: number;  // 0.7 (настраивается)
  binSize: number;       // шаг цены
};

// Функция
export function computeVolumeProfile(
  symbol: string,
  exchange: string,
  fromMs: number,
  toMs: number,
  opts?: { bins?: number; valueAreaPct?: number }
): Promise<VolumeProfile | null>;
```

### 2.8 Файлы для создания/изменения

| Файл | Действие | Описание |
|------|:--------:|----------|
| `src/lib/orderflow.ts` | **Изменить** | Добавить `computeVolumeProfile()`, типы |
| `src/app/api/orderflow/volume-profile/route.ts` | **Создать** | API-роут |
| `src/components/VolumeProfile.tsx` | **Создать** | React-компонент (Recharts HorizontalBarChart) |
| `src/components/VolumeProfileHistory.tsx` | **Создать** | История Volume Profile по дням |
| `src/app/dashboard/orderflow/page.tsx` | **Изменить** | Добавить панель Volume Profile |
| `src/lib/__tests__/volumeProfile.test.ts` | **Создать** | Unit-тесты |
| `src/app/api/orderflow/volume-profile/__tests__/route.test.ts` | **Создать** | API-тесты |
| `src/components/__tests__/VolumeProfile.test.tsx` | **Создать** | Component-тесты |

### 2.9 Тесты

**Unit-тесты (computeVolumeProfile):**
- Пустой период → null
- 1 свеча → POC = единственный уровень
- 10 свечей с равномерным распределением → POC в центре
- 10 свечей с явным пиком → POC = уровень с пиком
- Value Area 70%: POC + соседние уровни до 70% → VAH > VAL
- Все свечи на одном уровне → POC = этот уровень, VA = одна строка
- Разные символы (BTC = 50000, ETH = 3000) → корректные бины
- Большой диапазон цен (10000-60000) → равномерное распределение бинов

**API-тесты:**
- GET без авторизации → 401
- GET с корректными параметрами → 200, VolumeProfile
- GET с некорректным символом → 400
- GET с отсутствующими данными → 200, null
- GET с разными range (1h, 4h, 1d) → корректный период

**Component-тесты:**
- Рендеринг Volume Profile с данными
- POC маркер отображается
- VAH/VAL линии отображаются
- Уровни с высоким объёмом (HVN) подсвечены
- Уровни с низким объёмом (LVN) затемнены
- Рендеринг без данных (null) → "No data"
- Рендеринг loading state → спиннер
- Адаптивность: разные размеры панели

### 2.10 Алгоритм computeVolumeProfile

```
function computeVolumeProfile(symbol, exchange, fromMs, toMs, opts):
  1. Читаем ObCandle за период:
     rows = prisma.obCandle.findMany({
       where: { symbol, exchange, interval: '1d' (или '1h' для коротких периодов),
                t: { gte: fromMs, lte: toMs } }
     })

  2. Определяем ценовой диапазон:
     priceMin = min(rows.l) - padding
     priceMax = max(rows.h) + padding
     binSize = (priceMax - priceMin) / bins

  3. Распределяем объём по бинам:
     Для каждой свечи:
       - распределяем v (volume) пропорционально wick/body по бинам
       (вариант: весь объём на close)
       levels[binOf(close)] += v

  4. Находим POC:
     poc = argmax(levels.volume)

  5. Вычисляем Value Area:
     total = sum(levels.volume)
     target = total * valueAreaPct
     vaVolume = levels[poc].volume
     vaLevels = [poc]
     expand up/down от poc, добавляя соседние уровни
     пока vaVolume < target
     vah = max(vaLevels.price)
     val = min(vaLevels.price)

  6. Возвращаем VolumeProfile
```

### 2.11 Шаги выполнения

- [x] **1. Добавить типы в `src/lib/orderflow.ts`** — VolumeProfile, VolumeProfileLevel
- [x] **2. Реализовать `computeVolumeProfile()`** в `src/lib/orderflow.ts`
- [x] **3. Написать unit-тесты** — `src/lib/__tests__/volumeProfile.test.ts`
- [x] **4. Создать API-роут** — `src/app/api/orderflow/volume-profile/route.ts`
- [x] **5. Написать API-тесты** — `src/app/api/orderflow/volume-profile/__tests__/route.test.ts`
- [x] **6. Создать компонент** — `src/components/VolumeProfile.tsx`
- [x] **7. Интегрировать в страницу orderflow** — добавлена панель Volume Profile
- [x] **8. Написать component-тесты** — `src/components/__tests__/VolumeProfile.test.tsx`
- [x] **9. Настроить в админке** — FeatureConfig для volumeProfile
- [x] **10. Проверить сборку и тесты** — `npm run build && npm test` ✅

---

## 3. Feature 2: Divergence Scanner (цена vs дельта/CVD)

### 3.1 Описание

**Divergence Scanner** — обнаруживает расхождения между движением цены
и дельтой/CVD (Cumulative Volume Delta). Это ключевой инструмент для
отличия истинного пробоя от ложного.

**Типы дивергенций:**
- **Regular Bearish Divergence**: цена делает HH (higher high), дельта
  делает LH (lower high) — продавцы слабеют, разворот вниз
- **Regular Bullish Divergence**: цена делает LL (lower low), дельта
  делает HL (higher low) — покупатели набирают силу, разворот вверх
- **Hidden Bullish Divergence**: цена делает HL (higher low), дельта
  делает LL (lower low) — тренд вверх продолжается
- **Hidden Bearish Divergence**: цена делает LH (lower high), дельта
  делает HH (higher high) — тренд вниз продолжается

### 3.2 Что делает для стратегии

- **Пробой уровня**: цена пробивает уровень, дельта падает → **ЛОЖНЫЙ
  ПРОБОЙ** → шорт от уровня (или отмена лонга)
- **Пробой уровня**: цена пробивает уровень, дельта растёт → **ИСТИННЫЙ
  ПРОБОЙ** → вход по направлению
- **Ложный пробой границы боковика**: цена пробивает VAH, дельта
  отрицательная → ложный пробой → вход в обратную сторону
- **Ретест уровня**: цена возвращается к уровню, дельта не падает —
  ретест, а не разворот

### 3.3 Где размещается

| Элемент | Расположение | Компонент |
|---------|:------------:|-----------|
| Divergence overlay | На графике orderflow (на свечах) | `src/components/DivergenceOverlay.tsx` |
| Divergence list | Панель под графиком (список дивергенций) | Встроено в orderflow page |
| Divergence history | `/dashboard/analytics` | `src/components/DivergenceHistory.tsx` |
| API | `/api/orderflow/divergence` | `src/app/api/orderflow/divergence/route.ts` |
| Библиотека | `src/lib/orderflow.ts` | `computeDivergence()` |

### 3.4 Data Flow

```
1. Клиент запрашивает /api/orderflow/divergence?symbol=BTCUSDT&exchange=binance-futures&range=1h&minStrength=2
2. API вызывает computeDivergence(symbol, exchange, fromMs, toMs, opts)
3. computeDivergence:
   a. Читает ObCandle (цена high/low) за период
   b. Читает ObTrade (delta/CVD) за тот же период (те же корзины)
   c. Находит экстремумы цены (peaks/troughs)
   d. Сравнивает с экстремумами дельты
   e. Если направление разное → дивергенция
   f. Классифицирует: regular/hidden, bullish/bearish
   g. Оценивает силу (количество баров между экстремумами, глубина расхождения)
4. Возвращает список DivergenceSignal[]
5. Компонент DivergenceOverlay рисует стрелки/маркеры на графике
```

### 3.5 Админка

**FeatureConfig** (ключ `divergenceScanner`):
```json
{
  "enabled": true,
  "minStrength": 2,
  "lookbackBars": 50,
  "minDivergenceBars": 5,
  "maxDivergenceBars": 30,
  "cvdMode": true
}
```

Настройки в `/admin/features`:
- Включение/отключение
- Минимальная сила дивергенции (1-5)
- Период поиска (количество свечей)
- Минимальное/максимальное расстояние между экстремумами
- Использовать CVD или raw delta

### 3.6 Миграции

**Опционально**: таблица `ObDivergence` для хранения обнаруженных
дивергенций (если нужна история). Можно не делать — считать на лету.

```prisma
model ObDivergence {
  id        BigInt   @id @default(autoincrement())
  symbol    String
  exchange  String
  t         DateTime @db.Timestamptz(3) // время обнаружения
  type      String   // regular_bullish | regular_bearish | hidden_bullish | hidden_bearish
  strength  Int      // 1-5
  priceHigh Float    // цена экстремума
  priceLow  Float
  deltaHigh Float    // дельта на экстремуме цены
  deltaLow  Float
  bars      Int      // количество свечей дивергенции
  confirmed Boolean  @default(false) // подтверждена последующим движением

  @@index([symbol, exchange, t])
}
```

### 3.7 Типы данных

```typescript
// src/lib/orderflow.ts (добавить)
export type DivergenceType = 'regular_bullish' | 'regular_bearish' | 'hidden_bullish' | 'hidden_bearish';

export type DivergenceSignal = {
  id: string;
  type: DivergenceType;
  strength: number;       // 1-5
  t: number;              // ms таймстемп обнаружения
  pricePeak: number;      // цена экстремума цены
  priceTrough: number;    // цена другого экстремума
  deltaPeak: number;      // значение дельты на первом экстремуме
  deltaTrough: number;    // значение дельты на втором
  bars: number;           // расстояние между экстремумами в свечах
  confirmed: boolean;     // подтверждена последующим движением
  label: string;          // "Regular Bearish", "Hidden Bullish" и т.д.
};

export type DivergenceResult = {
  signals: DivergenceSignal[];
  activeCount: number;    // неподтверждённые (последние N свечей)
  totalCount: number;
};

// Функция
export function computeDivergence(
  symbol: string,
  exchange: string,
  fromMs: number,
  toMs: number,
  opts?: { minStrength?: number; lookbackBars?: number }
): Promise<DivergenceResult | null>;
```

### 3.8 Файлы для создания/изменения

| Файл | Действие | Описание |
|------|:--------:|----------|
| `src/lib/orderflow.ts` | **Изменить** | Добавить `computeDivergence()`, типы |
| `src/app/api/orderflow/divergence/route.ts` | **Создать** | API-роут |
| `src/components/DivergenceOverlay.tsx` | **Создать** | Canvas overlay на график |
| `src/components/DivergenceHistory.tsx` | **Создать** | История дивергенций (таблица) |
| `src/app/dashboard/orderflow/page.tsx` | **Изменить** | Добавить Divergence overlay + панель |
| `prisma/migrations/..._add_ob_divergence/migration.sql` | **Создать** | Миграция (если нужна) |
| `src/lib/__tests__/divergence.test.ts` | **Создать** | Unit-тесты |
| `src/app/api/orderflow/divergence/__tests__/route.test.ts` | **Создать** | API-тесты |
| `src/components/__tests__/DivergenceOverlay.test.tsx` | **Создать** | Component-тесты |

### 3.9 Тесты

**Unit-тесты (computeDivergence):**
- Пустые данные → null
- Цена растёт, дельта растёт → нет дивергенции
- Цена делает HH, дельта делает LH → Regular Bearish Divergence
- Цена делает LL, дельта делает HL → Regular Bullish Divergence
- Цена делает HL, дельта делает LL → Hidden Bullish Divergence
- Цена делает LH, дельта делает HH → Hidden Bearish Divergence
- Сильная дивергенция (5+ bars) → strength = 5
- Слабая дивергенция (1-2 bars) → strength = 1-2
- Множественные дивергенции → все обнаружены
- Фильтр minStrength = 3 → только сильные
- CVD режим vs Delta режим → разные результаты

**API-тесты:**
- GET без авторизации → 401
- GET с корректными параметрами → 200, DivergenceResult
- GET с minStrength=5 → фильтр применён
- GET с некорректным range → 400

**Component-тесты:**
- DivergenceOverlay рисует маркеры на правильных местах
- Клик по маркеру показывает детали
- DivergenceHistory отображает список
- DivergenceHistory сортирует по силе/времени
- Пустой список → "No divergences detected"
- Loading state → спиннер

### 3.10 Алгоритм computeDivergence

```
function computeDivergence(symbol, exchange, fromMs, toMs, opts):
  1. Получаем свечи (ObCandle) и дельту (ObTrade) за период
     candles = fetchCandles(..., fromMs, toMs)
     delta = computeDelta(..., fromMs, toMs) // используем существующую функцию

  2. Синхронизируем свечи и дельту по времени
     // берём closePrice от свечей и delta от ObTrade

  3. Находим экстремумы (peak/trough) на цене:
     peaks = [] // индексы где price[i] > price[i-1] && price[i] > price[i+1]
     troughs = [] // индексы где price[i] < price[i-1] && price[i] < price[i+1]

  4. Для каждой пары соседних экстремумов одного типа:
     для peaks (i, i+1):
       priceChange = price[peaks[i+1]] - price[peaks[i]]
       deltaChange = delta[peaks[i+1]] - delta[peaks[i]]
       если priceChange > 0 && deltaChange < 0 → Regular Bearish
       если priceChange < 0 && deltaChange > 0 → Hidden Bullish

     для troughs (i, i+1):
       priceChange = price[troughs[i+1]] - price[troughs[i]]
       deltaChange = delta[troughs[i+1]] - delta[troughs[i]]
       если priceChange < 0 && deltaChange > 0 → Regular Bullish
       если priceChange > 0 && deltaChange < 0 → Hidden Bearish

  5. Оцениваем strength:
     - bars = distance between extrema
     - strength = min(5, floor(bars / 3) + 1)
     - корректировка: если deltaChange / priceChange > 2 → strength += 1

  6. Возвращаем DivergenceResult
```

### 3.11 Шаги выполнения

- [x] **1. Добавить типы в `src/lib/orderflow.ts`** — DivergenceSignal, DivergenceResult
- [x] **2. Реализовать `computeDivergence()`** в `src/lib/orderflow.ts`
- [ ] **3. Создать миграцию** (не требуется — считаем на лету)
- [x] **4. Написать unit-тесты** — `src/lib/__tests__/divergence.test.ts` (9 тестов)
- [x] **5. Создать API-роут** — `src/app/api/orderflow/divergence/route.ts`
- [x] **6. Написать API-тесты** — `src/app/api/orderflow/divergence/__tests__/route.test.ts` (10 тестов)
- [x] **7. Создать компонент DivergenceOverlay** — canvas overlay на свечи
- [x] **8. Создать компонент DivergenceHistory** — таблица дивергенций
- [x] **9. Интегрировать в orderflow page**
- [x] **10. Написать component-тесты** — 8 overlay + 9 history = 17 тестов
- [x] **11. Настроить в админке** — FeatureConfig `divergenceScanner`
- [x] **12. Проверить сборку и тесты** — 951/951 ✅

---

## 4. Feature 3: Bid/Ask Imbalance + Speed of Tape

### 4.1 Описание

**Bid/Ask Imbalance** — индикатор дисбаланса между лимитными ордерами
на покупку и продажу в стакане. Показывает, какая сторона контролирует
рынок на каждом ценовом уровне.

**Speed of Tape** — метрика скорости торговли: количество сделок в
единицу времени. Высокая скорость = крупные игроки активны.

### 4.2 Что делает для стратегии

- **На уровне**: если на уровне ask-объём в 3 раза больше bid — продавцы
  контролируют, пробой вверх маловероятен
- **Imbalance меняется** → крупный игрок входит/выходит
- **Speed of Tape + пробой**: скорость резко растёт → пробой с объёмом
  (истинный). Скорость падает → пробой выдыхается (ложный)

### 4.3 Где размещается

| Элемент | Расположение | Компонент |
|---------|:------------:|-----------|
| Imbalance indicator | Delta panel (B/A панель) на orderflow | Встроено в delta panel |
| Imbalance heatmap | Правая панель (рядом с profileBid/Ask) | `src/components/ImbalanceHeatmap.tsx` |
| Speed of Tape | Под свечами (рядом с дельтой) | Встроено в orderflow page |
| API | `/api/orderflow/imbalance` | `src/app/api/orderflow/imbalance/route.ts` |
| Библиотека | `src/lib/orderflow.ts` | `computeImbalance()` |

### 4.4 Data Flow

```
Imbalance:
  Используем существующий computeBA() — он уже считает bid/(bid+ask) ratio.
  Добавляем:
    - imbalanceRatio = (ask - bid) / (bid + ask)  // -1..1
    - threshold alerts (когда imbalance > 0.7 или < -0.7)

Speed of Tape:
  Читаем ObTrade за период: считаем количество сделок в минуту.
  count = prisma.obTrade.count({ where: { symbol, exchange, t: { gte, lte } } })
  tradesPerMinute = count / (minutes in period)
```

### 4.5 Админка

**FeatureConfig** (ключ `imbalanceIndicator`):
```json
{
  "enabled": true,
  "highImbalanceThreshold": 0.7,
  "lowImbalanceThreshold": -0.7,
  "speedOfTapeEnabled": true,
  "speedWindowMs": 60000
}
```

### 4.6 Миграции

**Не требуются** — используем существующие данные ObSnapshot, ObTrade.

### 4.7 Типы данных

```typescript
// src/lib/orderflow.ts (добавить)
export type Imbalance = {
  times: number[];
  ratio: number[];       // (ask - bid) / (bid + ask), -1..1
  fullBid: number[];     // полный bid объём
  fullAsk: number[];     // полный ask объём
  nearBid: number[];     // bid в ±1% от mid
  nearAsk: number[];     // ask в ±1% от mid
  // Сигналы
  alerts: ImbalanceAlert[];
};

export type ImbalanceAlert = {
  t: number;
  type: 'high_imbalance' | 'low_imbalance' | 'imbalance_flip';
  value: number;
  message: string;
};

export type SpeedOfTape = {
  times: number[];
  tradesPerMin: number[];  // сделок в минуту
  maxSpeed: number;
  avgSpeed: number;
  spikes: SpeedSpike[];    // всплески
};

export type SpeedSpike = {
  t: number;
  speed: number;
  threshold: number;       // N стандартных отклонений
};
```

### 4.8 Файлы для создания/изменения

| Файл | Действие | Описание |
|------|:--------:|----------|
| `src/lib/orderflow.ts` | **Изменить** | Добавить `computeImbalance()`, `computeSpeedOfTape()` |
| `src/app/api/orderflow/imbalance/route.ts` | **Создать** | API-роут |
| `src/components/ImbalanceHeatmap.tsx` | **Создать** | Тепловая карта дисбаланса |
| `src/app/dashboard/orderflow/page.tsx` | **Изменить** | Добавить imbalance + speed of tape |
| `src/lib/__tests__/imbalance.test.ts` | **Создать** | Unit-тесты |
| `src/app/api/orderflow/imbalance/__tests__/route.test.ts` | **Создать** | API-тесты |
| `src/components/__tests__/ImbalanceHeatmap.test.tsx` | **Создать** | Component-тесты |

### 4.9 Тесты

**Unit-тесты:**
- `computeImbalance` с равными bid/ask → ratio = 0
- `computeImbalance` с bid-only → ratio = -1
- `computeImbalance` с ask-only → ratio = 1
- `computeImbalance` с bid=3×ask → ratio = -0.5
- `computeImbalance` с пустыми данными → null
- `computeSpeedOfTape` с 1 сделкой в минуту → 1 trade/min
- `computeSpeedOfTape` с 100 сделками в минуту → spike detected
- `computeSpeedOfTape` с пустыми данными → null

**Component-тесты:**
- ImbalanceHeatmap отображает цветовую шкалу
- ImbalanceHeatmap показывает алерты
- Speed of Tape график рендерится
- Пустые данные → "No data"

### 4.10 Шаги выполнения

- [x] **1. Добавить типы** — Imbalance, ImbalanceAlert, SpeedOfTape
- [x] **2. Реализовать `computeImbalance()`** (использует computeBA)
- [x] **3. Реализовать `computeSpeedOfTape()`**
- [x] **4. Написать unit-тесты** — 10 тестов
- [x] **5. Создать API-роут** — /api/orderflow/imbalance
- [x] **6. Создать компонент ImbalanceHeatmap** — Recharts
- [x] **7. Интегрировать в orderflow page**
- [x] **8. Написать component-тесты** — 7 тестов
- [x] **9. Проверить сборку и тесты** — 976/976 ✅

---

## 5. Feature 4: Absorption Pattern Detector

### 5.1 Описание

**Absorption Pattern** — автоматическое обнаружение паттерна поглощения
ликвидности на стакане. Крупный игрок "впитывает" ликвидность на
определённом ценовом уровне, не давая цене уйти. Это признак
накопления/распределения.

**Признаки:**
- Цена торгуется в узком диапазоне (несколько тиков)
- Объём сделок аномально высокий
- Дельта около нуля (покупатели и продавцы равны)
- Bid/Ask imbalance меняется (одна сторона поглощает другую)
- Скорость ленты высокая

### 5.2 Что делает для стратегии

- **Перед пробоем уровня**: absorption на уровне → крупный игрок
  накапливает позицию → готовится пробой
- **Ложный пробой**: absorption на уровне, цена не уходит → накопление
  (не путать с ложным пробоем)
- **Граница боковика**: absorption на VAH → крупный игрок набирает
  шорт перед откатом

### 5.3 Где размещается

| Элемент | Расположение | Компонент |
|---------|:------------:|-----------|
| Absorption overlay | На графике orderflow | Встроено в DivergenceOverlay |
| Absorption list | Панель под графиком | Встроено в orderflow page |
| API | `/api/orderflow/absorption` | `src/app/api/orderflow/absorption/route.ts` |
| Библиотека | `src/lib/orderflow.ts` | `computeAbsorption()` |

### 5.4 Data Flow

```
1. Объединяем данные:
   - ObFootprint (buyVol, sellVol per price level per candle)
   - ObSnapshot (bidVol, askVol at each level)
   - ObTrade (общее количество сделок)

2. Для каждой свечи проверяем:
   - range = high - low (узкий диапазон)
   - volume = buyVol + sellVol (высокий объём)
   - delta = |buyVol - sellVol| / volume (около 0)
   - imbalance = |bid - ask| / (bid + ask) (меняется)

3. Если все условия выполнены → absorption signal
```

### 5.5 Админка

**FeatureConfig** (ключ `absorptionDetector`):
```json
{
  "enabled": true,
  "minVolumeMultiplier": 2.0,
  "maxRangeBars": 3,
  "maxDeltaRatio": 0.15,
  "minCandles": 2
}
```

### 5.6 Миграции

**Не требуются** — используем существующие данные.

### 5.7 Типы данных

```typescript
export type AbsorptionSignal = {
  t: number;                    // ms таймстемп
  price: number;                // цена (mid)
  range: number;                // диапазон (high - low)
  volume: number;               // объём
  avgVolume: number;            // средний объём за N свечей
  volumeMultiplier: number;     // volume / avgVolume
  deltaRatio: number;           // |buy - sell| / (buy + sell)
  duration: number;             // количество свечей
  strength: number;             // 1-5
  label: string;                // "Absorption", "Strong Absorption"
};

export type AbsorptionResult = {
  signals: AbsorptionSignal[];
  activeCount: number;
};
```

### 5.8 Файлы для создания/изменения

| Файл | Действие | Описание |
|------|:--------:|----------|
| `src/lib/orderflow.ts` | **Изменить** | Добавить `computeAbsorption()` |
| `src/app/api/orderflow/absorption/route.ts` | **Создать** | API-роут |
| `src/app/dashboard/orderflow/page.tsx` | **Изменить** | Добавить absorption overlay |
| `src/lib/__tests__/absorption.test.ts` | **Создать** | Unit-тесты |

### 5.9 Тесты

- Пустые данные → null
- Нормальный бар (низкий объём, широкий range) → no signal
- Высокий объём + узкий range + delta ≈ 0 → absorption detected
- 5 свечей подряд с absorption → duration = 5
- Объём в 3× выше среднего → volumeMultiplier = 3
- deltaRatio = 0.05 → сигнал (ниже порога 0.15)

### 5.10 Шаги выполнения

- [ ] **1. Добавить типы** — AbsorptionSignal, AbsorptionResult
- [ ] **2. Реализовать `computeAbsorption()`**
- [ ] **3. Создать API-роут**
- [ ] **4. Интегрировать в orderflow page**
- [ ] **5. Написать тесты**

---

## 6. Feature 5: Level-Based Annotation System

### 6.1 Описание

**Level-Based Annotation System** — позволяет трейдеру отмечать ключевые
ценовые уровни прямо на графике orderflow и annotate сделки на этих
уровнях. Интеграция с существующей системой аннотаций TradeAnnotation.

### 6.2 Что делает для стратегии

- **Отмечаешь уровень на графике** → добавляешь метку (POC, VAH, VAL,
  поддержка, сопротивление, накопление, распределение)
- **Сделка на уровне** → автоматически линкуется к уровню
- **Статистика по уровням** → на каких уровнях зарабатываешь (пробой,
  ложный пробой, отскок от уровня)

### 6.3 Где размещается

| Элемент | Расположение | Компонент |
|---------|:------------:|-----------|
| Level overlay | На canvas orderflow | `src/components/LevelOverlay.tsx` |
| Level editor | Правая панель (над profileBid/Ask) | Встроено |
| Level stats | `/dashboard/analytics` | `src/components/LevelStats.tsx` |
| API | `/api/orderflow/levels` | `src/app/api/orderflow/levels/route.ts` |

### 6.4 Модель данных

```prisma
model UserLevel {
  id           String   @id @default(cuid())
  userId       String
  symbol       String   // BTCUSDT
  exchange     String   // binance-futures
  price        Float    // цена уровня
  type         String   // support | resistance | poc | vah | val | accumulation | distribution
  label        String?  // пользовательская метка
  strength     Int      @default(1) // 1-5, сила уровня
  timeframe    String?  // 1h, 4h, 1d таймфрейм на котором определён
  color        String?  // кастомный цвет
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  deletedAt    DateTime? // soft delete

  @@unique([userId, symbol, exchange, price, type])
  @@index([userId, symbol, exchange])
}
```

### 6.5 Миграции

**Требуется новая миграция** — таблица `UserLevel`.

### 6.6 Файлы для создания/изменения

| Файл | Действие | Описание |
|------|:--------:|----------|
| `prisma/schema.prisma` | **Изменить** | Добавить модель UserLevel |
| `prisma/migrations/..._add_user_levels/migration.sql` | **Создать** | Миграция |
| `src/lib/levels.ts` | **Создать** | Библиотека управления уровнями |
| `src/app/api/orderflow/levels/route.ts` | **Создать** | CRUD API для уровней |
| `src/components/LevelOverlay.tsx` | **Создать** | Canvas overlay |
| `src/components/LevelStats.tsx` | **Создать** | Статистика по уровням |
| `src/app/dashboard/orderflow/page.tsx` | **Изменить** | Добавить Level overlay |
| `src/lib/__tests__/levels.test.ts` | **Создать** | Unit-тесты |
| `src/app/api/orderflow/levels/__tests__/route.test.ts` | **Создать** | API-тесты |

### 6.7 Шаги выполнения

- [ ] **1. Добавить модель UserLevel в schema.prisma**
- [ ] **2. Создать миграцию**
- [ ] **3. Реализовать `src/lib/levels.ts`** — CRUD, валидация
- [ ] **4. Создать API-роут** — CRUD /api/orderflow/levels
- [ ] **5. Создать компонент LevelOverlay** — рисование уровней на canvas
- [ ] **6. Интегрировать в orderflow page**
- [ ] **7. Написать тесты**

---

## 7. Feature 6: Cluster Search (поиск аномалий объёма)

### 7.1 Описание

**Cluster Search** — автоматический поиск свечей с аномальным объёмом,
дельтой или дисбалансом. Обнаруживает "умные деньги" до того, как они
двинут цену.

### 7.2 Что делает для стратегии

- **Перед пробоем**: cluster с аномальной дельтой на уровне → подготовка
  к пробою
- **Аномальный объём на уровне**: крупный игрок входит
- **Дисбаланс**: одна сторона доминирует

### 7.3 API

| Элемент | Расположение |
|---------|:------------:|
| API | `/api/orderflow/cluster-search` |
| Библиотека | `src/lib/orderflow.ts` — `computeClusterSearch()` |

### 7.4 Типы данных

```typescript
export type ClusterAnomaly = {
  t: number;
  price: number;
  type: 'high_volume' | 'high_delta' | 'high_imbalance' | 'low_volume';
  value: number;
  avgValue: number;
  stdDev: number;
  zScore: number;
  strength: number; // 1-5
};
```

### 7.5 Шаги выполнения

- [ ] **1. Добавить типы в orderflow.ts**
- [ ] **2. Реализовать computeClusterSearch()**
- [ ] **3. Создать API-роут**
- [ ] **4. Интегрировать в orderflow page**
- [ ] **5. Написать тесты**

---

## 8. Карта проекта: все изменения

### 8.1 Новые файлы

```
src/lib/
  └── levels.ts                 ⏳ Feature 5

src/components/
  ├── VolumeProfile.tsx          ⏳ Feature 1
  ├── VolumeProfileHistory.tsx   ⏳ Feature 1
  ├── DivergenceOverlay.tsx      ⏳ Feature 2
  ├── DivergenceHistory.tsx      ⏳ Feature 2
  ├── ImbalanceHeatmap.tsx       ⏳ Feature 3
  ├── LevelOverlay.tsx           ⏳ Feature 5
  └── LevelStats.tsx             ⏳ Feature 5

src/app/api/
  ├── orderflow/volume-profile/route.ts              ⏳ Feature 1
  ├── orderflow/volume-profile/__tests__/route.test.ts ⏳ Feature 1
  ├── orderflow/divergence/route.ts                  ⏳ Feature 2
  ├── orderflow/divergence/__tests__/route.test.ts   ⏳ Feature 2
  ├── orderflow/imbalance/route.ts                   ⏳ Feature 3
  ├── orderflow/imbalance/__tests__/route.test.ts    ⏳ Feature 3
  ├── orderflow/absorption/route.ts                  ⏳ Feature 4
  ├── orderflow/absorption/__tests__/route.test.ts   ⏳ Feature 4
  ├── orderflow/levels/route.ts                      ⏳ Feature 5
  ├── orderflow/levels/__tests__/route.test.ts       ⏳ Feature 5
  └── orderflow/cluster-search/route.ts              ⏳ Feature 6

src/lib/__tests__/
  ├── volumeProfile.test.ts       ⏳ Feature 1
  ├── divergence.test.ts          ⏳ Feature 2
  ├── imbalance.test.ts           ⏳ Feature 3
  ├── absorption.test.ts          ⏳ Feature 4
  └── levels.test.ts              ⏳ Feature 5

src/components/__tests__/
  ├── VolumeProfile.test.tsx           ⏳ Feature 1
  └── DivergenceOverlay.test.tsx       ⏳ Feature 2
```

### 8.2 Изменяемые файлы

```
src/lib/orderflow.ts              ⏳ Features 1, 2, 3, 4, 6
src/app/dashboard/orderflow/page.tsx ⏳ Features 1, 2, 3, 4, 5, 6
prisma/schema.prisma              ⏳ Feature 6 (UserLevel)
prisma/migrations/                ⏳ Feature 6 (новая миграция)
```

### 8.3 Итого

| Метрика | Значение |
|---------|:--------:|
| Новых файлов | ~25 |
| Изменяемых файлов | ~4 |
| Миграций | 1 (UserLevel) |
| Unit-тестов | ~50 |
| Component-тестов | ~20 |
| API-тестов | ~20 |
| Всего тестов | ~90 |

---

## 9. График выполнения

### Фаза 1: Orderflow Power (3-5 дней)

```
Feature 1: Volume Profile
  День 1: computeVolumeProfile + unit-тесты
  День 2: API + API-тесты
  День 3: Компонент + интеграция + component-тесты

Feature 2: Divergence Scanner
  День 2: computeDivergence + unit-тесты
  День 3: API + overlay + component-тесты
  День 3: Интеграция в orderflow page
```

### Фаза 2: Дополнительные индикаторы (3-4 дня)

```
Feature 3: Bid/Ask Imbalance + Speed of Tape
  День 4: computeImbalance + computeSpeedOfTape + тесты
  День 5: API + компонент + интеграция

Feature 4: Absorption Pattern Detector
  День 5: computeAbsorption + тесты
  День 6: API + интеграция
```

### Фаза 3: Инфраструктура (3-5 дней)

```
Feature 5: Level-Based Annotation System
  День 7: Миграция + модель UserLevel
  День 8: lib/levels.ts + API
  День 9: LevelOverlay + интеграция + тесты

Feature 6: Cluster Search
  День 10: computeClusterSearch + тесты
  День 11: API + интеграция
```

### Итого: ~11 рабочих дней

---

## Приложение A: Рекомендуемый порядок выполнения

С учётом твоей стратегии (уровни, пробои, ложные пробои):

| # | Feature | Зачем тебе | Дней |
|:-:|:-------:|:----------:|:----:|
| **1** | Volume Profile | Уровни POC/VAH/VAL — основа твоей стратегии | 3 |
| **2** | Divergence Scanner | Отличать истинный пробой от ложного | 2 |
| **3** | Bid/Ask Imbalance | Видеть кто контролирует уровень | 2 |
| **4** | Absorption Pattern | Видеть накопление перед пробоем | 2 |
| **5** | Level-Based Annotations | Связывать сделки с уровнями | 3 |
| **6** | Cluster Search | Поиск аномалий объёма | 2 |

**Рекомендую начать с Volume Profile** — это даёт самую большую ценность
для твоей стратегии и закладывает базу для Divergence Scanner (общий
набор данных ObCandle).

---

## Приложение B: Статус выполнения

```
Feature 1: Volume Profile
  [x] Типы в orderflow.ts
  [x] computeVolumeProfile()
  [x] api/orderflow/volume-profile/route.ts
  [x] components/VolumeProfile.tsx
  [x] page.tsx integration
  [x] Тесты

Feature 2: Divergence Scanner
  [x] Типы в orderflow.ts
  [x] computeDivergence()
  [x] api/orderflow/divergence/route.ts
  [x] components/DivergenceOverlay.tsx
  [x] components/DivergenceHistory.tsx
  [x] page.tsx integration
  [x] Тесты

Feature 3: Bid/Ask Imbalance + Speed of Tape
  [x] Типы в orderflow.ts
  [x] computeImbalance() + computeSpeedOfTape()
  [x] api/orderflow/imbalance/route.ts
  [x] components/ImbalanceHeatmap.tsx
  [x] page.tsx integration
  [x] Тесты

Feature 4: Absorption Pattern Detector
  [ ] Типы в orderflow.ts
  [ ] computeAbsorption()
  [ ] api/orderflow/absorption/route.ts
  [ ] page.tsx integration
  [ ] Тесты

Feature 5: Level-Based Annotation System
  [ ] Модель UserLevel в schema.prisma
  [ ] Миграция
  [ ] lib/levels.ts
  [ ] api/orderflow/levels/route.ts
  [ ] components/LevelOverlay.tsx
  [ ] components/LevelStats.tsx
  [ ] page.tsx integration
  [ ] Тесты

Feature 6: Cluster Search
  [ ] Типы в orderflow.ts
  [ ] computeClusterSearch()
  [ ] api/orderflow/cluster-search/route.ts
  [ ] page.tsx integration
  [ ] Тесты
```