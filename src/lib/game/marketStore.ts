// Хранилище общего рынка: генерация истории, догон до текущего часа и чтение
// свечей на любом таймфрейме.
//
// Разделение обязанностей: marketGen.ts знает КАК считается цена (чистые
// функции, без базы), а этот модуль — ЧТО уже посчитано и лежит в базе.
//
// Ленивость по инструментам сознательная: у нас 71 инструмент, у каждого до
// полутора лет часовой истории. Генерировать всё сразу — минуты работы и
// миллион строк ради данных, на которые никто не посмотрит. Историю получает
// тот инструмент, который реально открыли.
import { prisma } from "@/lib/db";
import assetsData from "@/data/assets.json";
import { isMarketOpen } from "@/lib/game/schedule";
import { getFeatureConfig } from "@/lib/featureConfig";
import type { Asset } from "@/engine/entities/types";
import {
  aggregate,
  bridgeMinutes,
  freshVolState,
  gapOpen,
  historyMonths,
  MS_DAY,
  MS_HOUR,
  MS_MINUTE,
  MS_PER_YEAR,
  newsForHour,
  newsRateForDay,
  NEWS_PER_DAY,
  NEWS_SPREAD,
  nextCandle,
  rand,
  regimeTimeline,
  type GeneratedCandle,
  type GeneratedNews,
} from "@/lib/game/marketGen";

export const ALL_ASSETS = assetsData as Asset[];

export const TF_1H = "1h";
export const TF_1D = "1d";

/** Таймфреймы, которые может попросить клиент, и их длительность. */
export const TIMEFRAMES: Record<string, number> = {
  "1m": MS_MINUTE,
  "5m": 5 * MS_MINUTE,
  "15m": 15 * MS_MINUTE,
  "1h": MS_HOUR,
  "4h": 4 * MS_HOUR,
  "1d": MS_DAY,
  "1w": 7 * MS_DAY,
  "1M": 30 * MS_DAY,
};

// Сколько баров максимум отдаём за раз: больше на экран всё равно не влезет,
// а трафик и память браузера жалко.
export const MAX_BARS = 1500;

export function getAsset(assetId: string): Asset | undefined {
  return ALL_ASSETS.find((a) => a.id === assetId);
}

function floorTo(ms: number, step: number): number {
  return Math.floor(ms / step) * step;
}

/**
 * Мир. Создаётся при первом обращении: сид случайный (один раз на установку),
 * начало истории — полтора года назад, чтобы у самых «старых» инструментов
 * было куда расти.
 */
export async function getMarket() {
  const existing = await prisma.gameMarket.findUnique({ where: { id: "world" } });
  if (existing) return existing;
  const startedAt = new Date(floorTo(Date.now() - Math.round(18 * 30.5 * MS_DAY), MS_HOUR));
  try {
    return await prisma.gameMarket.create({
      data: { id: "world", seed: `w-${Math.random().toString(36).slice(2, 12)}`, startedAt },
    });
  } catch {
    // Два запроса создали мир одновременно — уникальный ключ поймал второго.
    const world = await prisma.gameMarket.findUnique({ where: { id: "world" } });
    if (!world) throw new Error("Не удалось создать рынок");
    return world;
  }
}

/** Часовые бары инструмента, которых ещё нет в базе, — досчитать и записать. */
/**
 * Частота новостей из админки.
 *
 * Читается один раз на прогон догона, а не на каждый час: это одна и та же
 * строка конфигурации, и дёргать базу на каждом часу полутора лет истории
 * значило бы тысячи одинаковых запросов.
 */
async function newsRateConfig(): Promise<{ perDay: number; spread: number }> {
  try {
    const game = await getFeatureConfig("game");
    const raw = game as unknown as Record<string, unknown>;
    const perDay = typeof raw.newsPerDay === "number" ? raw.newsPerDay : NEWS_PER_DAY;
    const spreadPct = typeof raw.newsSpreadPct === "number" ? raw.newsSpreadPct : NEWS_SPREAD * 100;
    return {
      perDay: Math.max(0, Math.min(24, perDay)),
      spread: Math.max(0, Math.min(3, spreadPct / 100)),
    };
  } catch {
    // Конфигурации нет (тесты, первый запуск) — мир живёт на своих числах.
    return { perDay: NEWS_PER_DAY, spread: NEWS_SPREAD };
  }
}

/**
 * Идущие прямо сейчас расчёты истории — по одному на инструмент.
 *
 * Холодный расчёт одного инструмента — это до 18 месяцев часовых свечей, и
 * замер даёт больше секунды чистого процессорного времени (на слабом сервере
 * — несколько). Node однопоточный: всё это время приложение не обслуживает
 * никого. Без замка десять параллельных запросов считали ОДНО И ТО ЖЕ десять
 * раз — `skipDuplicates` спасал данные, но не процессор.
 *
 * Замок процессный, не общий на кластер: приложение живёт одним контейнером
 * (см. docker-compose.prod.yml). При росте до нескольких реплик сюда нужен
 * advisory lock Postgres.
 */
const running = new Map<string, Promise<void>>();

export async function ensureHistory(assetId: string, now = Date.now()): Promise<void> {
  const inFlight = running.get(assetId);
  if (inFlight) return inFlight;
  const task = generateHistory(assetId, now).finally(() => running.delete(assetId));
  running.set(assetId, task);
  return task;
}

async function generateHistory(assetId: string, now: number): Promise<void> {
  const asset = getAsset(assetId);
  if (!asset) return;
  const market = await getMarket();
  const seed = market.seed;

  const assetStart = Math.max(
    market.startedAt.getTime(),
    floorTo(now - historyMonths(seed, assetId) * 30 * MS_DAY, MS_HOUR),
  );
  const lastHourStart = floorTo(now, MS_HOUR);

  const last = await prisma.gameCandle.findFirst({
    where: { assetId, tf: TF_1H },
    orderBy: { ts: "desc" },
  });

  const cursor = last ? last.ts.getTime() + MS_HOUR : assetStart;
  let price = last ? last.close : asset.startPrice ?? 100;
  if (cursor > lastHourStart) return; // всё уже посчитано

  // Частоту новостей задаёт админка (/admin/game). Прошлое от этого не
  // меняется: часы, которые уже посчитаны и лежат в базе, не пересчитываются
  // никогда — правка знобит только будущее.
  const newsRate = await newsRateConfig();

  // Режимы считаются от начала мира: индекс дня общий для всех инструментов,
  // иначе «кризис» у разных бумаг случался бы в разные дни.
  const totalDays = Math.ceil((now - market.startedAt.getTime()) / MS_DAY) + 2;
  const regimes = regimeTimeline(seed, totalDays);

  const rows: GeneratedCandle[] = [];
  // Волатильность переносится от бара к бару — из-за этого спокойное идёт за
  // спокойным, а буйное за буйным. При догоне истории кусками состояние
  // начинается заново с долгосрочной средней: цена от этого не меняется,
  // меняется только «характер» первых часов после стыка.
  let vol = freshVolState(asset.baseVolatility * Math.sqrt(MS_HOUR / MS_PER_YEAR));
  const newsRows: GeneratedNews[] = [];
  const worldStart = market.startedAt.getTime();

  // Часы, когда рынок этого инструмента закрыт, пропускаются: свечи за них не
  // существует. Новости при этом продолжают выходить (мир не замирает на
  // выходных) — они копятся и разряжаются гэпом на открытии.
  let closedMs = 0;

  for (let ts = cursor; ts <= lastHourStart; ts += MS_HOUR) {
    const hourIndex = Math.round((ts - worldStart) / MS_HOUR);
    const dayIndex = Math.max(0, Math.floor((ts - worldStart) / MS_DAY));
    const regime = regimes[Math.min(regimes.length - 1, dayIndex)];
    const news = newsForHour(
      seed,
      hourIndex,
      ALL_ASSETS,
      regime.preset.driftModifier,
      ts,
      newsRateForDay(newsRate.perDay, newsRate.spread, dayIndex),
    );
    if (!isMarketOpen(asset.assetClass, ts)) {
      // Новости закрытого часа сохраняем: лента мира общая, и игрок должен
      // прочитать в воскресенье то, что откроет цену в понедельник.
      for (const item of news) newsRows.push({ ...item, ts });
      closedMs += MS_HOUR;
      continue;
    }
    if (closedMs > 0) {
      price = gapOpen(price, {
        seed,
        asset,
        index: hourIndex,
        closedMs,
        volModifier: regime.preset.volModifier,
      });
      closedMs = 0;
    }
    const step = nextCandle(price, {
      seed,
      asset,
      kind: "h",
      stepMs: MS_HOUR,
      // Индексы режимов внутри nextCandle считаются от ts, поэтому передаём
      // время относительно начала мира, а не абсолютное.
      regimes,
      ts: ts - worldStart,
      index: hourIndex,
      news,
      vol,
    });
    const candle = step.candle;
    vol = step.vol;
    price = candle.close;
    rows.push({ ...candle, ts });
    for (const item of news) newsRows.push({ ...item, ts });
  }
  if (rows.length === 0) return;

  // createMany с skipDuplicates: два параллельных запроса могли начать
  // генерацию одного и того же куска — второй просто ничего не добавит.
  await prisma.gameCandle.createMany({
    data: rows.map((c) => ({ assetId, tf: TF_1H, ts: new Date(c.ts), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
    skipDuplicates: true,
  });

  // Дневная свёртка: пересобираем затронутые дни целиком (последний день
  // всегда неполный и будет дописан следующим прогоном).
  const daily = aggregate(rows, MS_DAY);
  for (const day of daily) {
    await prisma.gameCandle.upsert({
      where: { assetId_tf_ts: { assetId, tf: TF_1D, ts: new Date(day.ts) } },
      create: { assetId, tf: TF_1D, ts: new Date(day.ts), open: day.open, high: day.high, low: day.low, close: day.close, volume: day.volume },
      update: { high: day.high, low: day.low, close: day.close, volume: day.volume },
    });
  }

  // Новости пишем один раз на мир: они общие, а генерируются попутно с любым
  // инструментом — от дубликатов спасает детерминированный id.
  if (newsRows.length > 0) {
    await prisma.gameMarketNews.createMany({
      data: newsRows.map((n) => ({
        id: `n-${Math.round(n.ts)}-${n.assetId ?? n.sector ?? "global"}`,
        ts: new Date(n.ts),
        assetId: n.assetId,
        sector: n.sector,
        impact: n.impact,
        headline: n.headline,
        shockPct: n.shockPct,
      })),
      skipDuplicates: true,
    });
  }
}

export interface MarketCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

function toMarketCandles(rows: { ts: Date; open: number; high: number; low: number; close: number; volume: number }[]): MarketCandle[] {
  return rows.map((r) => ({ t: r.ts.getTime(), o: r.open, h: r.high, l: r.low, c: r.close, v: r.volume }));
}

/**
 * Свечи инструмента на выбранном таймфрейме.
 *
 * До часа включительно строим из часового ряда: минутки — мостом внутри
 * каждого часа, 5m/15m — склейкой этих минуток. Выше часа — склейкой часов
 * (для 1d берём готовую дневную свёртку: она уже посчитана).
 */
/**
 * С какого момента у инструмента есть публичная история.
 *
 * У слотов, отданных под листинг фондов, свечи генератор считает с начала
 * мира — но показывать их до выхода фонда на биржу нельзя: у бумаги, которая
 * разместилась вчера, не может быть годового графика. Отрезаем всё до даты
 * листинга.
 */
async function historyStart(assetId: string, stepMs: number): Promise<number> {
  if (!assetId.startsWith("FND_SLOT_")) return 0;
  const listing = await prisma.gameListing.findUnique({ where: { assetId }, select: { listedAt: true } });
  if (!listing) return Number.POSITIVE_INFINITY;
  // Округляем к началу бара, а не режем по секунде размещения: иначе у
  // фонда, вышедшего на биржу пять минут назад, график был бы пустым до
  // конца часа — бумага как будто не торгуется вовсе.
  return Math.floor(listing.listedAt.getTime() / stepMs) * stepMs;
}

export async function readCandles(assetId: string, tf: string, limit: number, now = Date.now()): Promise<MarketCandle[]> {
  const asset = getAsset(assetId);
  const stepMs = TIMEFRAMES[tf];
  if (!asset || !stepMs) return [];
  await ensureHistory(assetId, now);
  const market = await getMarket();
  const bars = Math.max(1, Math.min(MAX_BARS, limit));
  // У бумаги, разместившейся вчера, не может быть годового графика.
  const since = await historyStart(assetId, stepMs);

  if (stepMs >= MS_DAY) {
    const source = await prisma.gameCandle.findMany({
      where: { assetId, tf: TF_1D },
      orderBy: { ts: "desc" },
      take: Math.min(2000, bars * Math.ceil(stepMs / MS_DAY) + 10),
    });
    const daily = toMarketCandles(source.reverse()).filter((candle) => candle.t >= since);
    if (stepMs === MS_DAY) return daily.slice(-bars);
    return aggregateMarket(daily, stepMs).slice(-bars);
  }

  if (stepMs >= MS_HOUR) {
    const source = await prisma.gameCandle.findMany({
      where: { assetId, tf: TF_1H },
      orderBy: { ts: "desc" },
      take: Math.min(4000, bars * Math.ceil(stepMs / MS_HOUR) + 10),
    });
    const hourly = toMarketCandles(source.reverse()).filter((candle) => candle.t >= since);
    if (stepMs === MS_HOUR) return hourly.slice(-bars);
    return aggregateMarket(hourly, stepMs).slice(-bars);
  }

  // Минуты и всё, что мельче часа: разворачиваем нужное число часов в минутки.
  const hoursNeeded = Math.ceil((bars * stepMs) / MS_HOUR) + 1;
  const source = await prisma.gameCandle.findMany({
    where: { assetId, tf: TF_1H },
    orderBy: { ts: "desc" },
    take: Math.min(1000, hoursNeeded),
  });
  const hours = source.reverse();
  const worldStart = market.startedAt.getTime();
  const currentHour = floorTo(now, MS_HOUR);
  const minutes: MarketCandle[] = [];
  for (const row of hours) {
    const ts = row.ts.getTime();
    const hourIndex = Math.round((ts - worldStart) / MS_HOUR);
    // Текущий час ещё не закончился — отдаём только прошедшие минуты, иначе
    // игрок увидел бы будущее.
    const count = ts === currentHour ? Math.max(1, Math.floor((now - ts) / MS_MINUTE) + 1) : 60;
    const hourCandle: GeneratedCandle = { ts, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume };
    for (const m of bridgeMinutes(hourCandle, asset, market.seed, hourIndex, count)) {
      minutes.push({ t: m.ts, o: m.open, h: m.high, l: m.low, c: m.close, v: m.volume });
    }
  }
  const result = stepMs === MS_MINUTE ? minutes : aggregateMarket(minutes, stepMs);
  return result.filter((candle) => candle.t >= since).slice(-bars);
}

function aggregateMarket(candles: MarketCandle[], bucketMs: number): MarketCandle[] {
  const generated = candles.map((c) => ({ ts: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v }));
  return aggregate(generated, bucketMs).map((c) => ({ t: c.ts, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }));
}

export interface Quote {
  price: number;
  /** Изменение за сегодня, % — из него скринер строит список «что движется». */
  dayChangePct: number;
  /** Торгуется ли инструмент прямо сейчас (см. lib/game/schedule). */
  open: boolean;
}

/**
 * Текущие цены инструментов. Это последняя минутка текущего часа — та же
 * цена, которую игрок видит на графике.
 */
// ── Ретенция ──────────────────────────────────────────────────────────────
//
// Замер на рабочей базе: 280 тысяч часовых свечей и 118 МБ на 67 из 81
// инструмента, плюс около двух мегабайт в сутки — навсегда. Полный мир с
// историей за все 18 месяцев — это больше миллиона строк. Ровно та же
// история, что была с PageView (см. docs/SELF_HOSTING.md §9.3), только там
// её чистит крон, а здесь не чистило ничто.
//
// Часовые свечи держим столько, сколько нужно графику: самый долгий
// таймфрейм в терминале — недельный, и полгода часовых баров покрывают его с
// запасом. Дневные не трогаем вовсе: они мелкие, а история «с начала мира»
// нужна и рейтингу, и графику на годовом масштабе.

/** Сколько дней держим часовые свечи. */
export const CANDLE_RETENTION_DAYS = Number(process.env.GAME_CANDLE_RETENTION_DAYS ?? 180);
/** Сколько дней держим ленту мира и новости. */
export const EVENT_RETENTION_DAYS = Number(process.env.GAME_EVENT_RETENTION_DAYS ?? 30);

/**
 * Убрать то, что уже никому не показывается.
 *
 * Вызывается из цикла ботов — единственного места, которое работает и без
 * игроков. Дневные свечи и результаты сезонов не трогаются: это история мира,
 * а не кэш.
 */
export async function purgeOldMarketData(now = Date.now()): Promise<{ candles: number; news: number; events: number }> {
  const candleEdge = new Date(now - CANDLE_RETENTION_DAYS * MS_DAY);
  const eventEdge = new Date(now - EVENT_RETENTION_DAYS * MS_DAY);
  const [candles, news, events] = await Promise.all([
    prisma.gameCandle.deleteMany({ where: { tf: TF_1H, ts: { lt: candleEdge } } }),
    prisma.gameMarketNews.deleteMany({ where: { ts: { lt: eventEdge } } }),
    prisma.gameWorldEvent.deleteMany({ where: { createdAt: { lt: eventEdge } } }),
  ]);
  return { candles: candles.count, news: news.count, events: events.count };
}

export async function readQuotes(assetIds: string[], now = Date.now()): Promise<Record<string, Quote>> {
  const unique = Array.from(new Set(assetIds)).filter((id) => !!getAsset(id));
  const market = await getMarket();
  const currentHour = floorTo(now, MS_HOUR);
  const quotes: Record<string, Quote> = {};

  // Кому история и правда нужна — выясняем ОДНИМ запросом.
  //
  // Раньше здесь на каждый инструмент уходил свой ensureHistory, а он на
  // входе делает findFirst. Замер: 60 инструментов — 62 запроса в базу на
  // один опрос котировок, то есть 15 запросов в секунду с одного игрока при
  // опросе раз в четыре секунды. Двадцать игроков — триста запросов в секунду
  // на ровном месте.
  const fresh = await prisma.gameCandle.groupBy({
    by: ["assetId"],
    where: { assetId: { in: unique }, tf: TF_1H },
    _max: { ts: true },
  });
  const lastByAsset = new Map(fresh.map((row) => [row.assetId, row._max.ts?.getTime() ?? 0]));
  const stale = unique.filter((id) => (lastByAsset.get(id) ?? 0) < currentHour);
  if (stale.length > 0) await Promise.all(stale.map((id) => ensureHistory(id, now)));
  const dayStart = new Date(floorTo(now, MS_DAY));
  const [rows, dayRows] = await Promise.all([
    prisma.gameCandle.findMany({ where: { assetId: { in: unique }, tf: TF_1H, ts: new Date(currentHour) } }),
    prisma.gameCandle.findMany({ where: { assetId: { in: unique }, tf: TF_1D, ts: dayStart } }),
  ]);
  const byAsset = new Map(rows.map((r) => [r.assetId, r]));
  const byDay = new Map(dayRows.map((r) => [r.assetId, r]));

  // Свечи текущего часа нет — значит рынок этого инструмента закрыт. Цена
  // всё равно нужна: по ней считаются открытые позиции и рисуется портфель,
  // просто она стоит на последнем закрытии. Берём последний бар одним
  // запросом (DISTINCT ON), а не по инструменту: на выходных «отсутствуют»
  // сразу все акции, и тридцать запросов каждые четыре секунды — это то, чем
  // выходные и кладут сервер.
  const missing = unique.filter((id) => !byAsset.has(id));
  if (missing.length > 0) {
    const last = await prisma.$queryRaw<
      Array<{ assetId: string; open: number; high: number; low: number; close: number; volume: number }>
    >`
      SELECT DISTINCT ON ("assetId") "assetId", "open", "high", "low", "close", "volume"
      FROM "GameCandle"
      WHERE "tf" = ${TF_1H} AND "assetId" = ANY(${missing})
      ORDER BY "assetId", "ts" DESC
    `;
    for (const row of last) byAsset.set(row.assetId, { ...row, tf: TF_1H, ts: new Date(currentHour) });
  }

  for (const id of unique) {
    const asset = getAsset(id);
    const row = byAsset.get(id);
    if (!asset || !row) continue;
    const tradable = isMarketOpen(asset.assetClass, now);
    if (!tradable) {
      const dayOpenClosed = byDay.get(id)?.open ?? row.close;
      quotes[id] = {
        price: row.close,
        dayChangePct: dayOpenClosed > 0 ? ((row.close - dayOpenClosed) / dayOpenClosed) * 100 : 0,
        open: false,
      };
      continue;
    }
    const hourIndex = Math.round((currentHour - market.startedAt.getTime()) / MS_HOUR);
    const minuteInHour = Math.max(1, Math.floor((now - currentHour) / MS_MINUTE) + 1);
    const minutes = bridgeMinutes(
      { ts: currentHour, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume },
      asset,
      market.seed,
      hourIndex,
      minuteInHour,
    );
    const price = minutes.length > 0 ? minutes[minutes.length - 1].close : row.close;
    const dayOpen = byDay.get(id)?.open ?? row.open;
    quotes[id] = {
      price,
      dayChangePct: dayOpen > 0 ? ((price - dayOpen) / dayOpen) * 100 : 0,
      open: true,
    };
  }
  return quotes;
}

/**
 * Текущий рыночный режим — его знает только сервер: таймлайн считается от
 * начала мира, и у всех игроков он один.
 */
export async function readRegime(now = Date.now()) {
  const market = await getMarket();
  const dayIndex = Math.max(0, Math.floor((now - market.startedAt.getTime()) / MS_DAY));
  const timeline = regimeTimeline(market.seed, dayIndex + 2);
  const today = timeline[Math.min(timeline.length - 1, dayIndex)];
  // Сколько дней рынок уже в этом режиме — для подписи «Боковик 3д».
  let daysInRegime = 0;
  for (let i = dayIndex; i >= 0 && timeline[i]?.type === today.type; i--) daysInRegime++;
  return { type: today.type, daysInRegime, driftModifier: today.preset.driftModifier, volModifier: today.preset.volModifier };
}

/** Новости мира за период — общие для всех игроков. */
export async function readNews(sinceMs: number, limit = 50) {
  const rows = await prisma.gameMarketNews.findMany({
    where: { ts: { gte: new Date(sinceMs) } },
    orderBy: { ts: "desc" },
    take: Math.min(200, limit),
  });
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts.getTime(),
    assetId: r.assetId,
    sector: r.sector,
    impact: r.impact,
    headline: r.headline,
    shockPct: r.shockPct,
  }));
}

/** Случайный сид для новых миров — вынесено, чтобы тесты могли его подменить. */
export function randomSeed(): string {
  return `w-${Math.floor(rand(String(Date.now())) * 1e9).toString(36)}`;
}
