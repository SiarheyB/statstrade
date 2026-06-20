# Forex-статистика и импорт сделок из MetaTrader 4 / 5

> Архитектурный анализ и план внедрения.
> Автор-роль: Senior Full-Stack / DB-архитектор / эксперт по алготрейдингу и финансовой аналитике / дизайнер.
> Документ описывает **как** добавить поддержку рынка Forex и загрузку истории сделок из файлов MT4/MT5, не сломав существующий крипто-движок.

---

## 0. TL;DR (краткая рекомендация)

1. **Не пересчитывать деньги для Forex.** Текущий движок реконструирует PnL из `(exitPrice − entryPrice) × qty` в валюте котировки ([`src/lib/analytics/positions.ts:148`](src/lib/analytics/positions.ts)). Для EURUSD это случайно совпадает с USD, но для EURGBP результат в GBP, для USDJPY — в JPY, а брокерский отчёт всегда в **валюте счёта**. Поэтому для импортированных сделок нужно **брать готовые `profit / swap / commission` прямо из отчёта брокера**, а не вычислять.
2. **Импортированные сделки — это уже закрытые раунд-трипы.** MT4/MT5 отдаёт завершённые позиции с ценой/временем открытия и закрытия и итоговой прибылью. Реконструкция из филлов им не нужна и даже вредна (netting-модель не умеет hedging — два встречных EURUSD одновременно).
3. **Рекомендуемая архитектура:** ввести отдельную таблицу `ImportedTrade` (готовый раунд-трип) и **слить** её с реконструированными крипто-сделками в один массив `RoundTripTrade[]` перед `computeMetrics`. Крипто-движок остаётся нетронутым; Forex считается точно.
4. **Источник данных — новое измерение `source`** на `ExchangeAccount` (`exchange | mt4 | mt5 | manual`). Биржевая CCXT-синхронизация остаётся только для `source = exchange`; для MT — загрузка файла.
5. **Парсер MT** — HTML-отчёт в первую очередь (универсальный экспорт MT4/MT5), XLSX опционально. S/L из отчёта мапим в `stopLoss` → R-мультипликатор работает «из коробки».

Дальше — обоснование, схема БД, форматы файлов, пайплайн импорта, новые метрики, UI/UX и поэтапный план.

---

## 1. Как устроена система сейчас (точки интеграции)

Поток данных полностью «на лету», промежуточных таблиц сделок нет:

```
Fill (БД)  ──►  reconstructTrades()  ──►  RoundTripTrade[]  ──►  computeMetrics()  ──►  Metrics
  ▲                (positions.ts)            (+ аннотации)          (metrics.ts)
  │
CCXT sync (sync.ts)  /  demo.ts
```

| Слой | Файл | Роль | Что важно для Forex |
|------|------|------|---------------------|
| Атом данных | `prisma/schema.prisma` → `model Fill` | один исполненный филл | есть `realizedPnl Float?`, `market`, `fee`, `feeCurrency` — но **нет** swap, lots, contractSize, accountCurrency |
| Реконструкция | [`src/lib/analytics/positions.ts`](src/lib/analytics/positions.ts) | филлы → раунд-трипы (average-cost, netting) | PnL = `(exit−entry)×qty` в **quote**; `feeInQuote()` конвертирует комиссию; **игнорирует `realizedPnl`** |
| Типы | [`src/lib/analytics/types.ts`](src/lib/analytics/types.ts) | `FillInput`, `RoundTripTrade` | `RoundTripTrade` уже содержит всё нужное для метрик |
| Метрики | [`src/lib/analytics/metrics.ts`](src/lib/analytics/metrics.ts) | 60+ метрик, брейкдауны | считает в одной валюте; есть `byExchange`, `bySymbol`, `bySide`, `byHour` |
| Реестр метрик | [`src/lib/analytics/metric-defs.ts`](src/lib/analytics/metric-defs.ts) | единый источник списка метрик | сюда добавляются forex-метрики |
| Источник (API) | [`src/lib/sync.ts`](src/lib/sync.ts), [`src/lib/exchanges.ts`](src/lib/exchanges.ts) | CCXT → нормализованные филлы | **только биржи**; `isExchangeId` валидирует `binance/bybit/okx` |
| Аккаунт | `model ExchangeAccount` | один источник данных | `exchange` (строка), `marketType` (spot/futures/both), `balance` |
| Витрина | [`src/app/api/stats/route.ts`](src/app/api/stats/route.ts) | собирает филлы → реконструкция → метрики → JSON | **единственная точка**, где трейды собираются для UI |
| Аннотации | `model TradeAnnotation` | ТВХ/тип/паттерн/ошибка/SL по `tradeKey` | `tradeKey = accountId:symbol:market:entryTimeMs` ([`positions.ts:52`](src/lib/analytics/positions.ts)) |
| Аккаунты UI | [`src/app/dashboard/accounts/page.tsx`](src/app/dashboard/accounts/page.tsx) | подключение биржи, синк-прогресс | сюда добавляется «Импорт из файла» |

**Вывод:** есть ровно две естественные точки врезки — (а) на уровне `Fill` (загнать MT-данные как филлы) или (б) на уровне `RoundTripTrade[]` в [`stats/route.ts`](src/app/api/stats/route.ts) (слить готовые сделки). Ниже показано, почему вариант (б) для Forex правильнее.

---

## 2. Почему Forex — это не «ещё одна биржа»

| Аспект | Крипто (сейчас) | Forex / MT | Последствие |
|--------|-----------------|------------|-------------|
| **Объём** | базовая монета (BTC) | **лоты**: 1 standard lot = 100 000 единиц базовой валюты (mini 10k, micro 1k) | нужен `contractSize`; `qty(units) = lots × contractSize` |
| **PnL** | выводится из цены | **сообщается брокером** в валюте счёта (с учётом pip value и конверсии) | пересчёт из цены неверен на кроссах/JPY/металлах |
| **Валюта результата** | quote (часто USDT) | валюта **счёта** (USD/EUR/…), отличается от quote инструмента | нельзя смешивать; нужен `accountCurrency` |
| **Pip / point** | нет понятия | pip = 0.0001 (для JPY = 0.01); MT «point» = дробный пип (0.00001 / 0.001) | новая метрика «пипсы», pip-based ожидание |
| **Своп (rollover)** | нет | ночная плата ±, тройной в среду/пятницу | отдельная статья расходов, важная метрика |
| **Стоимость входа** | комиссия (taker/maker) | **commission** и/или **спред**; ECN-счета берут commission, market-maker — спред | разделять commission и spread-cost |
| **Хеджинг** | netting (одна нетто-позиция) | MT4 и MT5-hedging допускают **встречные позиции по одному символу одновременно** | netting-реконструкция теряет/искажает такие сделки |
| **Инструменты** | спот/перп | FX-пары, металлы (XAUUSD), индексы, нефть, CFD, крипто-CFD | парсинг символа сложнее; `base/quote` не всегда 3+3 |
| **Сессии** | 24/7 | Азия / Лондон / Нью-Йорк, выходные-гэпы | брейкдаун по торговым сессиям |
| **Плечо/маржа** | есть, но не в отчёте | leverage, margin, free margin | опционально для риск-метрик |
| **S/L, T/P** | вручную (`stopLoss`) | **есть в отчёте** | авто-заполнение `stopLoss` → R-мультипликатор бесплатно |

**Главный тезис:** для Forex деньги (`profit`, `swap`, `commission`) нужно **читать из отчёта**, а из цены вычислять только **пипсы и лоты** (для отображения и пип-метрик). Это убирает 90% риска некорректной аналитики.

---

## 3. Ключевое архитектурное решение

### Вариант A — «MT как филлы» (реконструкция)
Разбить каждую закрытую сделку MT на два синтетических филла (open + close), записать в `Fill`, прогнать существующий движок.

- ✅ Переиспользует пайплайн и `stats/route.ts` без изменений в выдаче.
- ❌ Движок пересчитает PnL из цены → **неверно** для кроссов/JPY/металлов (валюта котировки ≠ валюта счёта).
- ❌ Netting-модель **не поддерживает hedging** (встречные позиции по одному символу) — частый кейс в MT.
- ❌ Своп/commission неоткуда взять корректно (придётся «впихивать» в `fee`, теряя семантику).

### Вариант B — «Импортированные сделки» (рекомендуется) ✅
Хранить закрытые раунд-трипы как есть в новой таблице `ImportedTrade`; в [`stats/route.ts`](src/app/api/stats/route.ts) **слить** их с реконструированными крипто-трейдами в общий `RoundTripTrade[]` и отдать в `computeMetrics`.

- ✅ Крипто-движок не трогаем — нулевой риск регрессии.
- ✅ Точные деньги: берём брокерские `profit/swap/commission` в валюте счёта.
- ✅ Поддержка hedging и частичных закрытий «бесплатно» — брокер уже посчитал каждый раунд-трип.
- ✅ S/L из отчёта → `stopLoss` → работает `avgRR` ([`metrics.ts:402`](src/lib/analytics/metrics.ts)).
- ✅ Стабильный `tradeKey` для аннотаций (например `accountId:ticket`).
- ⚠️ Нужна одна врезка в `stats/route.ts` (слияние) и расширение `RoundTripTrade` опциональными полями (`lots`, `pips`, `swap`, `commission`).

**Решение: Вариант B.** Ниже всё проектируется под него.

```
                       ┌─ Fill (crypto) ─► reconstructTrades() ─┐
RoundTripTrade[]  ◄─────┤                                        ├─► computeMetrics()
                       └─ ImportedTrade (forex/MT) ─────────────┘
                                  (готовые раунд-трипы)
```

---

## 4. Изменения схемы БД (Prisma)

### 4.1. `ExchangeAccount` — новое измерение источника
```prisma
model ExchangeAccount {
  // ... существующие поля ...
  source          String  @default("exchange") // exchange | mt4 | mt5 | manual
  accountCurrency String  @default("USD")       // валюта счёта для MT/forex
  assetClass      String?                        // null=crypto | "forex"
  // apiKey/apiSecret делаем необязательными ИЛИ храним пустую строку для MT
  importedTrades  ImportedTrade[]
}
```
- Для `source != exchange` поля API-ключей не используются (можно хранить `""` зашифрованным или сделать nullable — предпочтительно nullable, но это правка `accounts/route.ts` и `crypto`).
- CCXT-синк (`sync.ts`, кнопка «Sync») **гейтится** на `source === "exchange"`. `isExchangeId` больше не должен блокировать создание MT-аккаунта.

### 4.2. Новая модель `ImportedTrade` (закрытый раунд-трип)
```prisma
// Готовый закрытый раунд-трип, импортированный из отчёта MT4/MT5 (или внесённый
// вручную). В отличие от крипто-сделок, НЕ реконструируется — деньги берутся
// как есть из отчёта брокера (валюта счёта).
model ImportedTrade {
  id           String          @id @default(cuid())
  accountId    String
  account      ExchangeAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  source       String          // mt4 | mt5 | manual
  externalId   String          // ticket (MT4) / position_id (MT5) — для дедупликации
  symbol       String          // EURUSD, XAUUSD, US30 ...
  base         String          // EUR
  quote        String          // USD
  market       String          @default("forex")
  side         String          // long | short
  lots         Float           // объём в лотах
  qty          Float           // lots * contractSize (единицы базовой валюты)
  contractSize Float           @default(100000)
  entryTime    DateTime
  exitTime     DateTime
  entryPrice   Float
  exitPrice    Float
  stopLoss     Float?          // из отчёта (S/L)
  takeProfit   Float?
  commission   Float           @default(0) // валюта счёта
  swap         Float           @default(0) // валюта счёта
  grossProfit  Float           // брокерский profit ДО swap/commission, валюта счёта
  netPnl       Float           // grossProfit + swap - commission (итог, валюта счёта)
  pips         Float?          // (exit-entry)/pipSize * dir — для отображения/метрик
  currency     String          @default("USD") // валюта счёта на момент сделки
  comment      String?
  importedAt   DateTime        @default(now())
  importBatch  String?         // id партии загрузки (для отката)

  @@unique([accountId, externalId]) // идемпотентность повторной загрузки
  @@index([accountId])
  @@index([accountId, exitTime])
}
```

### 4.3. Аннотации
`TradeAnnotation.tradeKey` остаётся универсальным. Для импортированных сделок генерируем стабильный ключ: `"{accountId}:{externalId}"` (или сохраняем формат `accountId:symbol:market:entryTimeMs`, чтобы переиспользовать существующую логику). Главное — **детерминированность** при повторном импорте: `externalId` (ticket/position_id) идеален.

### 4.4. Миграция
Пишется вручную (как `prisma/migrations/20260618100000_pattern/`): `ALTER TABLE "ExchangeAccount" ADD COLUMN ...`, `CREATE TABLE "ImportedTrade" ...`, индексы. Затем `prisma generate` (типы) и `prisma migrate deploy` (Vercel применит на сборке).

---

## 5. Форматы файлов MT4 и MT5

### 5.1. MT4 — «Statement» (HTML, .htm)
Экспорт: вкладка **Account History → правый клик → Save as Report / Save as Detailed Report**. Это HTML-таблица. Также бывает **Detailed Statement** с расширенными колонками.

Раздел **Closed Transactions** — каждая строка = завершённая позиция:

| Колонка | Поле | Заметка |
|---------|------|---------|
| Ticket | `externalId` | уникальный id ордера |
| Open Time | `entryTime` | формат `YYYY.MM.DD HH:MM:SS` |
| Type | `side` | `buy`→long, `sell`→short; **`balance`/`credit`/`deposit`/`withdrawal` → пропустить** |
| Size | `lots` | объём в лотах |
| Item | `symbol` | EURUSD, XAUUSD … |
| Price | `entryPrice` | цена открытия |
| S / L | `stopLoss` | может быть 0 → null |
| T / P | `takeProfit` | 0 → null |
| Close Time | `exitTime` | |
| Price | `exitPrice` | цена закрытия |
| Commission | `commission` | валюта счёта |
| Taxes | (в `commission` или отдельно) | обычно 0 |
| Swap | `swap` | ± |
| Profit | `grossProfit` | валюта счёта, **итог по цене без swap/commission** |

> MT4 **order-centric**: одна строка = один полный раунд-трип. Частичные закрытия MT4 порождает как отдельные тикеты с пометкой в комментарии (`from #...`) — каждый импортируется как самостоятельная сделка (это корректно).

### 5.2. MT5 — «History Report» (HTML .html или XLSX)
Экспорт: вкладка **History → правый клик → Report → HTML/Open XML (XLSX)**. MT5 разделяет **Orders / Deals / Positions**.

Опорный раздел — **Deals** (сделки/исполнения):

| Колонка | Поле | Заметка |
|---------|------|---------|
| Time | время сделки | |
| Deal | id сделки | |
| Symbol | `symbol` | |
| Type | `buy`/`sell` | |
| Direction | `in` / `out` / `in/out` | **`in` открывает, `out` закрывает** позицию |
| Volume | объём (лоты) | |
| Price | цена | |
| Order | id ордера | |
| Commission | `commission` | |
| Fee | доп. сбор | сложить с commission |
| Swap | `swap` | |
| Profit | `profit` | заполнен на закрывающих (`out`) сделках |
| Balance | баланс после | для фильтра balance-операций |

**Сборка раунд-трипа MT5:** группировать deals по `position_id` (в HTML это колонка `Position`/в комментарии, в XLSX доступно явно), либо использовать раздел **Positions**, если брокер его экспортирует. Каждая позиция: open = первый `in`-deal, close = последний `out`-deal, `grossProfit` = сумма `profit` по `out`-сделкам, `swap`/`commission` = суммы по всем сделкам позиции. `in/out` (разворот) трактуется как закрытие+открытие.

> MT5 **deal-centric** + поддерживает **hedging** (несколько позиций по одному символу). Поэтому группировка по `position_id`, а не по символу — обязательна. Это ещё один аргумент против Варианта A.

### 5.3. Подводные камни парсинга
- **Локаль чисел:** MT использует пробел/неразрывный пробел как разделитель тысяч, точку как десятичный; некоторые локали — запятую. Парсер чисел должен убирать пробелы/`&nbsp;` и нормализовать `,`/`.`.
- **Время и таймзона:** MT хранит время сервера брокера (часто GMT+2/+3). Нужна настройка `brokerTimezone` на аккаунте, иначе брейкдаун по часам/сессиям «съедет». По умолчанию — UTC с предупреждением.
- **Balance-операции:** строки `balance / credit / deposit / withdrawal / correction` исключать из сделок (но можно использовать для расчёта депозита/`balance` аккаунта).
- **Символы:** суффиксы брокера (`EURUSD.m`, `EURUSDpro`, `XAUUSD#`) — нормализовать (срезать суффикс после известного 6-символьного кода/металла). `base/quote`: первые 3 / последние 3 для FX; металлы (`XAU/XAG`)→ base, quote из остатка; индексы (`US30`, `NAS100`) → `base=symbol, quote=accountCurrency`.
- **contractSize / pipSize по классам:** FX = 100000, pip 0.0001 (JPY → pip 0.01); XAUUSD ≈ 100 oz; индексы/CFD — из таблицы или 1. Держать конфиг-таблицу дефолтов + переопределение в настройках.
- **Кодировка:** MT-отчёты бывают UTF-8 и UTF-16/Windows-1251 (RU-сборки) — детектить кодировку.

### 5.4. Технология парсинга
- **HTML** (приоритет, универсален для MT4 и MT5): серверный парс таблиц. Лёгкая зависимость `cheerio` или `node-html-parser`; таблицу детектим по сигнатуре заголовков. Без браузерного DOM.
- **XLSX** (опционально, чистый для MT5): SheetJS (`xlsx`). Добавляет вес — делаем фазой 2.
- **CSV** некоторых брокеров — тривиальный фолбэк.

---

## 6. Пайплайн импорта

```
[Drag&Drop файла .htm/.html/.xlsx]
        │  multipart/form-data, лимит 5–10 МБ
        ▼
POST /api/accounts/[id]/import            ← новый маршрут (source = mt4|mt5)
        │  1. detectFormat(buffer) → mt4 | mt5
        │  2. parseStatement(buffer, fmt) → ParsedTrade[]   (lib/mt/parse-mt4.ts / parse-mt5.ts)
        │  3. normalize → ImportedTrade rows (symbol/base/quote/lots/qty/pips/netPnl…)
        │  4. dedupe по @@unique([accountId, externalId]) (skipDuplicates)
        │  5. createMany + importBatch id (для отката)
        ▼
{ parsed, imported, skipped, errors[], dateRange, symbols[] }  ← превью/итог
```

Дизайн модулей:
```
src/lib/mt/
  detect.ts        // сигнатуры заголовков → "mt4" | "mt5" | "unknown"
  parse-mt4.ts     // HTML Statement → ParsedTrade[]
  parse-mt5.ts     // HTML/XLSX Deals → группировка по position → ParsedTrade[]
  symbols.ts       // нормализация символа, base/quote, contractSize, pipSize
  numbers.ts       // локале-устойчивый парс чисел/дат/таймзоны
  to-imported.ts   // ParsedTrade → Prisma ImportedTrade input
  types.ts         // ParsedTrade, ImportResult
```

Свойства пайплайна:
- **Идемпотентность:** повторная загрузка того же отчёта ничего не дублирует (`externalId` уникален на аккаунт).
- **Превью перед записью** (UX, фаза 2): сначала `dryRun=true` → показать таблицу распознанного, дать подтвердить.
- **Откат партии:** `importBatch` позволяет «удалить последнюю загрузку».
- **Частичные ошибки:** строки, которые не распарсились, собираются в `errors[]` и показываются, остальные импортируются.
- **Серверный парсинг** (не в браузере): контроль размера, без утечки данных в клиент до подтверждения.

---

## 7. Интеграция в движок и новые метрики

### 7.1. Слияние в `stats/route.ts`
После `reconstructTrades(inputs)` добавить:
```ts
const imported = await prisma.importedTrade.findMany({ where: { account: { userId }, ...marketFilter } });
const importedAsTrades: RoundTripTrade[] = imported.map(toRoundTrip); // netPnl/fees/result уже посчитаны
let trades = [...reconstructed, ...importedAsTrades].sort(byExitTime);
```
Фильтры `accountId/market/symbol/from/to` применяются к объединённому массиву (для `ImportedTrade` — на уровне SQL where + пост-фильтр по датам, как сейчас для трейдов). Аннотации цепляются так же по `tradeKey`.

### 7.2. Расширение `RoundTripTrade` (опциональные поля)
```ts
// types.ts — не ломает крипто-путь (поля optional)
lots?: number;
pips?: number;
swap?: number;
commission?: number;
assetClass?: "crypto" | "forex";
accountCurrency?: string;
```
`result` для импортированных: `classify(netPnl)` так же (win/loss/breakeven). `returnPct`: для Forex не считать как `netPnl/(entryPrice*qty)` (разные валюты!) — лучше оставить пип-ориентированную метрику и **R-мультипликатор** (есть S/L). Для % доходности использовать `netPnl / accountEquity` на уровне метрик, не на сделке.

### 7.3. Новые метрики (в `metrics.ts` + `metric-defs.ts`)
| Метрика | Формула | Группа |
|---------|---------|--------|
| Всего пипсов | Σ `pips` | Доходность (forex) |
| Средние пипсы/сделку | mean(`pips`) | Эффективность |
| Σ свопов | Σ `swap` | Комиссии |
| Σ комиссий (отдельно) | Σ `commission` | Комиссии |
| Объём в лотах | Σ `lots` | Активность |
| Средний лот | mean(`lots`) | Активность |
| По сессии (Asia/London/NY/overlap) | `bucketStats` по часу UTC→сессия | Брейкдаун |
| Пип-ожидание | mean(`pips`) с учётом winrate | Эффективность |

`byExchange` для MT можно переименовать на UI в «по источнику/брокеру». `bySymbol`, `bySide`, `byHour`, `byMonth`, `avgRR` уже работают для импортированных сделок без изменений.

### 7.4. Новый брейкдаун «по торговым сессиям»
```ts
// session из часа UTC: 22–7 Asia, 7–16 London, 13–22 NY, 13–16 overlap
const bySession = bucketStats(sorted, (t) => sessionOf(t.entryTime), (k) => k);
```
Добавляется как `Bucket[]` (тот же тип, что `byPattern`) → переиспользует `<BreakdownChart>` и тумблер P&L/Win Rate, которые уже есть.

---

## 8. UI/UX

### 8.1. Подключение источника (страница «Биржи» → «Источники»)
- Расширить выбор: к `binance/bybit/okx` добавить карточки **MetaTrader 4**, **MetaTrader 5**, **Ручной ввод** ([`accounts/page.tsx`](src/app/dashboard/accounts/page.tsx), массив `EXCHANGES`).
- Для MT — вместо полей API-ключей: **поле «Название»**, **валюта счёта** (USD/EUR/…), **таймзона брокера**, и зона **Drag & Drop файла отчёта** (.htm/.html/.xlsx).
- После загрузки — **таблица-превью** распознанных сделок (символ, направление, лоты, открытие/закрытие, пипсы, P&L, swap) с итогами и кнопкой «Импортировать N сделок» / «Отмена».
- Карточка MT-аккаунта: вместо кнопки «Sync» — «**Загрузить ещё отчёт**» и «Откатить последнюю загрузку».

### 8.2. Фильтры рынка
- В фильтре «рынок» ([`dashboard/page.tsx`](src/app/dashboard/page.tsx), [`trades/page.tsx`](src/app/dashboard/trades/page.tsx)) добавить опцию **Forex** рядом со Spot/Futures (через `assetClass`/`market = "forex"`).
- Новый брейкдаун-дашборд **«По сессиям»** (P&L / Win Rate тумблер — паттерн уже реализован для «Паттерн»).

### 8.3. Таблица «Сделки»
- Условные колонки для forex-строк: **Лоты**, **Пипсы**, **Swap** (показывать, когда в выборке есть forex; для крипто — скрывать/прочерк).
- Экспорт CSV/PDF — добавить эти колонки (как делали для «Паттерн»).
- График сделки ([`TradeChart`](src/components/TradeChart.tsx)) для forex берёт котировки иначе (нет CCXT OHLCV для FX) — фаза 3 (опц. провайдер котировок) либо скрыть мини-график для forex.

### 8.4. Настройки
- **Настройки сделок** — секция «Forex»: дефолтные `contractSize`/`pipSize` по символам, таймзона брокера, валюта счёта по умолчанию.
- i18n: добавить ключи (EN+RU) в [`dictionaries.ts`](src/lib/i18n/dictionaries.ts): `acc.source.mt4/mt5/manual`, `import.dropzone`, `import.preview`, `import.confirm`, `trades.col.lots/pips/swap`, `dash.bySession`, `metric.totalPips/avgPips/totalSwap/totalLots`, `settings.forex.*`.

### 8.5. Капитал/депозит
Для MT валюта счёта ≠ USD. `balance`/«Капитал» ([`dashboard/page.tsx:126`](src/app/dashboard/page.tsx)) считать в `accountCurrency`; форматтер [`fmtUsd`](src/lib/format.ts) обобщить до `fmtMoney(value, currency)` либо хранить отдельный форматтер. Депозит можно вытащить из balance-операций отчёта (initial deposit) или ввести вручную.

---

## 9. Корректность и крайние случаи (чек-лист)

- [ ] Кроссы/JPY/металлы: **деньги только из отчёта**, не из цены.
- [ ] Hedging MT5: группировка по `position_id`, не по символу.
- [ ] Частичные закрытия: каждый закрытый объём — отдельная импорт-сделка; суммы сходятся с отчётом.
- [ ] Balance/credit/deposit строки исключены из сделок, но учтены в депозите.
- [ ] Локаль чисел (пробелы/запятые), кодировка (UTF-8/UTF-16/1251), формат даты `YYYY.MM.DD HH:MM:SS`.
- [ ] Таймзона брокера → корректные брейкдауны по часу/сессии.
- [ ] Суффиксы символов брокера нормализованы; `base/quote` верны для FX/металлов/индексов.
- [ ] Идемпотентность: повторная загрузка не дублирует (`@@unique[accountId, externalId]`).
- [ ] Swap/commission не теряются и не задваиваются (commission+fee MT5).
- [ ] `stopLoss` из S/L → `avgRR` считается; нулевой S/L → null.
- [ ] Смешанная выборка crypto+forex в дашборде: либо разделять по `assetClass`, либо явно помечать, что суммарный P&L в разных валютах (предупреждение). **Рекомендация:** не складывать разные валюты счёта — фильтровать дашборд по аккаунту/классу.

---

## 10. Поэтапный план внедрения

### Фаза 1 — MVP (MT4/MT5 HTML, базовая Forex-аналитика)
1. Миграция: `ImportedTrade` + поля `source/accountCurrency/assetClass` на `ExchangeAccount`.
2. `src/lib/mt/`: `detect.ts`, `parse-mt4.ts`, `parse-mt5.ts`, `symbols.ts`, `numbers.ts`, `to-imported.ts` (+ `cheerio`/`node-html-parser`).
3. `POST /api/accounts/[id]/import` (multipart, серверный парс, dedupe, createMany).
4. UI: карточки MT4/MT5/Manual в «Биржах», dropzone + превью + подтверждение; гейтинг CCXT-синка на `source==="exchange"`.
5. Слияние `ImportedTrade` в [`stats/route.ts`](src/app/api/stats/route.ts); опц. поля в `RoundTripTrade`.
6. i18n EN/RU. `prisma generate` + `tsc` + локальный прогон.

### Фаза 2 — Полная Forex-аналитика и UX
7. Новые метрики: пипсы, swap/commission раздельно, лоты, **по сессиям**; `metric-defs.ts`.
8. Условные колонки «Сделки» (лоты/пипсы/swap) + экспорт CSV/PDF.
9. Превью с dry-run, откат партии (`importBatch`), частичные ошибки.
10. XLSX-парсер (SheetJS) для MT5; настройки contractSize/pipSize/таймзона/валюта.
11. Мульти-валютный форматтер денег.

### Фаза 3 — Дополнительно
12. Провайдер котировок FX для мини-графика сделки.
13. Поддержка cTrader / generic CSV.
14. Авто-импорт по расписанию (если у брокера есть API/FTP-выгрузка) — переиспользует `scheduler`.

---

## 11. Тестирование
- **Golden-файлы:** реальные/синтетические отчёты MT4 и MT5 (HTML + XLSX), включая: hedging, частичные закрытия, JPY-пары, XAUUSD, индексы, RU-локаль (1251), balance-операции, суффиксы символов.
- **Юнит-тесты парсера:** файл → ожидаемый `ParsedTrade[]` (числа, даты, side, дедуп).
- **Тест сумм:** Σ `netPnl` импортированных = итоговый P&L из футера отчёта (допуск на округление).
- **Идемпотентность:** двойная загрузка → `imported=0` второй раз.
- **Снапшот метрик:** известный отчёт → ожидаемые winRate/PF/avgRR/пипсы.

## 12. Безопасность/приватность
- Парсинг **на сервере**; лимит размера файла (5–10 МБ), таймаут, валидация MIME/расширения.
- MT-источники не хранят API-ключей (поля nullable) → меньше секретов.
- Файл не сохраняем на диск (обрабатываем в памяти), в БД — только нормализованные сделки.

## 13. Решения, которые нужно подтвердить (product)
1. Складывать ли крипто и forex в один дашборд, или строго разделять по аккаунту/классу из-за разных валют счёта? (рекомендация — разделять).
2. Поддерживаемые форматы в MVP: только HTML или сразу + XLSX?
3. Брать депозит из отчёта (balance-операции) или вводить вручную?
4. Нужен ли ручной ввод сделок (`source=manual`) в MVP или позже?
5. Мультивалютность UI (EUR/GBP-счета) в MVP или фиксируем USD-отображение с пометкой?

---

### Приложение A. Затрагиваемые файлы (карта работ)
| Файл | Изменение |
|------|-----------|
| `prisma/schema.prisma` + новая миграция | `ImportedTrade`, поля `source/accountCurrency/assetClass` |
| `src/lib/mt/*` (новое) | парсеры MT4/MT5, нормализация символов/чисел |
| `src/app/api/accounts/[id]/import/route.ts` (новое) | загрузка и импорт файла |
| `src/app/api/accounts/route.ts` | создание MT-аккаунта без ключей; гейт `isExchangeId` |
| `src/app/api/accounts/[id]/sync/route.ts` / `src/lib/sync.ts` | синк только для `source==="exchange"` |
| `src/app/api/stats/route.ts` | слияние `ImportedTrade` в `RoundTripTrade[]` |
| `src/lib/analytics/types.ts` | опц. поля `lots/pips/swap/commission/assetClass` |
| `src/lib/analytics/metrics.ts` | пипсы, свопы, лоты, `bySession` |
| `src/lib/analytics/metric-defs.ts` | регистрация новых метрик |
| `src/app/dashboard/accounts/page.tsx` | карточки MT/Manual, dropzone, превью |
| `src/app/dashboard/page.tsx`, `trades/page.tsx` | фильтр Forex, дашборд «по сессиям», колонки лоты/пипсы/swap |
| `src/lib/i18n/dictionaries.ts` | ключи EN/RU |
| `src/lib/format.ts` | мультивалютный форматтер денег |

_Документ описывает целевую архитектуру; реализация — по фазам выше после согласования решений из раздела 13._
