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
import type { Asset } from "@/engine/entities/types";
import {
  aggregate,
  bridgeMinutes,
  gapOpen,
  historyMonths,
  MS_DAY,
  MS_HOUR,
  MS_MINUTE,
  newsForHour,
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
export async function ensureHistory(assetId: string, now = Date.now()): Promise<void> {
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

  // Режимы считаются от начала мира: индекс дня общий для всех инструментов,
  // иначе «кризис» у разных бумаг случался бы в разные дни.
  const totalDays = Math.ceil((now - market.startedAt.getTime()) / MS_DAY) + 2;
  const regimes = regimeTimeline(seed, totalDays);

  const rows: GeneratedCandle[] = [];
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
    const news = newsForHour(seed, hourIndex, ALL_ASSETS, regime.preset.driftModifier, ts);
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
    const candle = nextCandle(price, {
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
    });
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
export async function readCandles(assetId: string, tf: string, limit: number, now = Date.now()): Promise<MarketCandle[]> {
  const asset = getAsset(assetId);
  const stepMs = TIMEFRAMES[tf];
  if (!asset || !stepMs) return [];
  await ensureHistory(assetId, now);
  const market = await getMarket();
  const bars = Math.max(1, Math.min(MAX_BARS, limit));

  if (stepMs >= MS_DAY) {
    const source = await prisma.gameCandle.findMany({
      where: { assetId, tf: TF_1D },
      orderBy: { ts: "desc" },
      take: Math.min(2000, bars * Math.ceil(stepMs / MS_DAY) + 10),
    });
    const daily = toMarketCandles(source.reverse());
    if (stepMs === MS_DAY) return daily.slice(-bars);
    return aggregateMarket(daily, stepMs).slice(-bars);
  }

  if (stepMs >= MS_HOUR) {
    const source = await prisma.gameCandle.findMany({
      where: { assetId, tf: TF_1H },
      orderBy: { ts: "desc" },
      take: Math.min(4000, bars * Math.ceil(stepMs / MS_HOUR) + 10),
    });
    const hourly = toMarketCandles(source.reverse());
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
  return result.slice(-bars);
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
export async function readQuotes(assetIds: string[], now = Date.now()): Promise<Record<string, Quote>> {
  const unique = Array.from(new Set(assetIds)).filter((id) => !!getAsset(id));
  const market = await getMarket();
  const currentHour = floorTo(now, MS_HOUR);
  const quotes: Record<string, Quote> = {};

  await Promise.all(unique.map((id) => ensureHistory(id, now)));
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
