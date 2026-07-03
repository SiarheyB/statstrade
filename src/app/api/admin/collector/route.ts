import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound } from "@/lib/admin";
import { serverError } from "@/lib/api";

export const maxDuration = 20;
export const dynamic = "force-dynamic";

// Раздел «Карта ордеров» админ-панели. Совмещает два источника:
//  1) живой статус collector-сервиса (GET /metrics, Bearer-токен) — synced,
//     resync, темп записи; деградирует мягко, если сервис недоступен.
//  2) агрегаты по факту записи в Postgres (таблицы Ob*) — скорость наполнения,
//     свежесть (lag) и live-превью последнего снимка стакана.
//
// Все частые агрегаты считаются ТОЧЕЧНО по каждому фиду через индекс
// (symbol, exchange, t) — мгновенно при любом размере таблиц. Раньше здесь был
// GROUP BY по всей ObSnapshot (десятки млн строк): на слабом сервере скан
// держал запрос дольше таймаута туннеля, и админка получала 502.
// Единственный по-настоящему тяжёлый показатель — count(*) на фид — вынесен в
// отдельный кэш с длинным TTL.

type FeedRow = {
  symbol: string;
  exchange: string;
  total: number;
  last_min: number;
  last_hour: number;
  last_t: Date | null;
  oldest_t: Date | null;
};

type SeriesRow = { exchange: string; minute: Date; c: number };
type PreviewRow = { price: number; bidVol: number; askVol: number };

async function fetchCollectorMetrics(): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const base = process.env.COLLECTOR_URL;
  const token = process.env.COLLECTOR_METRICS_TOKEN;
  if (!base || !token) return { ok: false, error: "COLLECTOR_URL / COLLECTOR_METRICS_TOKEN не заданы" };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${base.replace(/\/$/, "")}/metrics`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: `collector ответил ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// Список фидов — из маленькой ObRollupBucket (не сканируем сырые таблицы).
// Фолбэк, пока rollup пуст (свежий деплой): DISTINCT по снапшотам за сутки —
// партиции ограничивают скан одним-двумя днями.
async function listFeeds(): Promise<{ symbol: string; exchange: string }[]> {
  const fromRollup = await prisma.$queryRaw<{ symbol: string; exchange: string }[]>`
    SELECT DISTINCT symbol, exchange FROM "ObRollupBucket" ORDER BY symbol, exchange
  `;
  if (fromRollup.length > 0) return fromRollup;
  return prisma.$queryRaw<{ symbol: string; exchange: string }[]>`
    SELECT DISTINCT symbol, exchange FROM "ObSnapshot"
    WHERE t > now() - interval '24 hours'
    ORDER BY symbol, exchange
  `;
}

// --- Тотальные счётчики (count(*) на фид) — единственный тяжёлый агрегат.
// Индексный подсчёт миллионов записей занимает секунды, поэтому TTL длинный.
const TOTALS_TTL_MS = 10 * 60_000;
let totalsCache: { at: number; data: Map<string, { total: number; oldest: Date | null }> } | null = null;
let totalsInflight: Promise<Map<string, { total: number; oldest: Date | null }>> | null = null;

async function getTotals(
  feeds: { symbol: string; exchange: string }[],
): Promise<Map<string, { total: number; oldest: Date | null }>> {
  if (totalsCache && Date.now() - totalsCache.at < TOTALS_TTL_MS) return totalsCache.data;
  if (totalsInflight) return totalsInflight;
  totalsInflight = (async () => {
    const map = new Map<string, { total: number; oldest: Date | null }>();
    // Последовательно, чтобы не занимать несколько соединений тяжёлыми COUNT.
    for (const f of feeds) {
      const [row] = await prisma.$queryRaw<{ total: number; oldest: Date | null }[]>`
        SELECT count(*)::int AS total, min(t) AS oldest
        FROM "ObSnapshot" WHERE symbol = ${f.symbol} AND exchange = ${f.exchange}
      `;
      map.set(`${f.symbol}|${f.exchange}`, { total: row?.total ?? 0, oldest: row?.oldest ?? null });
    }
    totalsCache = { at: Date.now(), data: map };
    return map;
  })().finally(() => {
    totalsInflight = null;
  });
  return totalsInflight;
}

// --- Быстрые агрегаты (индексные точечные запросы) — кэш на 10с, чтобы
// несколько вкладок админки не дублировали работу.
type HeavyStats = {
  feeds: FeedRow[];
  series: SeriesRow[];
  tableStats: { tbl: string; last_min: number; last_t: Date | null }[];
  collector: Awaited<ReturnType<typeof fetchCollectorMetrics>>;
};
const HEAVY_TTL_MS = 10_000;
let heavyCache: { at: number; data: HeavyStats } | null = null;
let heavyInflight: Promise<HeavyStats> | null = null;

async function getHeavyStats(): Promise<HeavyStats> {
  if (heavyCache && Date.now() - heavyCache.at < HEAVY_TTL_MS) return heavyCache.data;
  if (heavyInflight) return heavyInflight; // не запускать несколько сборов параллельно
  heavyInflight = (async () => {
    const feedList = await listFeeds();
    const totals = await getTotals(feedList);

    // Свежесть/темп на фид: max(t) и счётчики за минуту/час — range-скан по
    // индексу (symbol, exchange, t), читает только последние записи фида.
    const feeds: FeedRow[] = [];
    for (const f of feedList) {
      const [row] = await prisma.$queryRaw<
        { last_min: number; last_hour: number; last_t: Date | null }[]
      >`
        SELECT
          (SELECT count(*)::int FROM "ObSnapshot"
            WHERE symbol = ${f.symbol} AND exchange = ${f.exchange}
              AND t > now() - interval '1 minute') AS last_min,
          (SELECT count(*)::int FROM "ObSnapshot"
            WHERE symbol = ${f.symbol} AND exchange = ${f.exchange}
              AND t > now() - interval '1 hour') AS last_hour,
          (SELECT max(t) FROM "ObSnapshot"
            WHERE symbol = ${f.symbol} AND exchange = ${f.exchange}) AS last_t
      `;
      const tot = totals.get(`${f.symbol}|${f.exchange}`);
      feeds.push({
        symbol: f.symbol,
        exchange: f.exchange,
        total: tot?.total ?? 0,
        last_min: row?.last_min ?? 0,
        last_hour: row?.last_hour ?? 0,
        last_t: row?.last_t ?? null,
        oldest_t: tot?.oldest ?? null,
      });
    }

    // Скорость наполнения за час: по каждому фиду через индекс, агрегация по
    // биржам — в JS (строк «минута × биржа» максимум 60 × фиды).
    const seriesMap = new Map<string, SeriesRow>();
    for (const f of feedList) {
      const rows = await prisma.$queryRaw<{ minute: Date; c: number }[]>`
        SELECT date_trunc('minute', t) AS minute, count(*)::int AS c
        FROM "ObSnapshot"
        WHERE symbol = ${f.symbol} AND exchange = ${f.exchange}
          AND t > now() - interval '60 minutes'
        GROUP BY minute
      `;
      for (const r of rows) {
        const key = `${f.exchange}|${r.minute.getTime()}`;
        const cur = seriesMap.get(key);
        if (cur) cur.c += r.c;
        else seriesMap.set(key, { exchange: f.exchange, minute: r.minute, c: r.c });
      }
    }
    const series = [...seriesMap.values()].sort(
      (a, b) => a.minute.getTime() - b.minute.getTime(),
    );

    // Сопутствующие потоки: max(t)/строк-за-минуту тоже точечно на фид.
    const tableStats: { tbl: string; last_min: number; last_t: Date | null }[] = [];
    for (const tbl of ["ObTrade", "ObFootprint", "ObBigTrade"] as const) {
      let lastMin = 0;
      let lastT: Date | null = null;
      for (const f of feedList) {
        const [row] = await prisma.$queryRawUnsafe<
          { last_min: number; last_t: Date | null }[]
        >(
          `SELECT
             (SELECT count(*)::int FROM "${tbl}"
               WHERE symbol = $1 AND exchange = $2 AND t > now() - interval '1 minute') AS last_min,
             (SELECT max(t) FROM "${tbl}"
               WHERE symbol = $1 AND exchange = $2) AS last_t`,
          f.symbol,
          f.exchange,
        );
        lastMin += row?.last_min ?? 0;
        if (row?.last_t && (!lastT || row.last_t > lastT)) lastT = row.last_t;
      }
      tableStats.push({ tbl, last_min: lastMin, last_t: lastT });
    }

    const collector = await fetchCollectorMetrics();
    const data: HeavyStats = { feeds, series, tableStats, collector };
    heavyCache = { at: Date.now(), data };
    return data;
  })().finally(() => {
    heavyInflight = null;
  });
  return heavyInflight;
}

export async function GET(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  const url = new URL(req.url);
  const previewSymbol = url.searchParams.get("symbol");
  const previewExchange = url.searchParams.get("exchange");

  try {
    const { feeds, series, tableStats, collector } = await getHeavyStats();

    // Live-превью: последний снимок выбранного (или первого) фида.
    let preview: { symbol: string; exchange: string; t: Date | null; bins: PreviewRow[] } | null = null;
    const target = previewSymbol && previewExchange
      ? { symbol: previewSymbol, exchange: previewExchange }
      : feeds[0]
        ? { symbol: feeds[0].symbol, exchange: feeds[0].exchange }
        : null;
    if (target) {
      const bins = await prisma.$queryRaw<PreviewRow[]>`
        SELECT price, "bidVol" AS "bidVol", "askVol" AS "askVol"
        FROM "ObSnapshot"
        WHERE symbol = ${target.symbol} AND exchange = ${target.exchange}
          AND t = (SELECT max(t) FROM "ObSnapshot" WHERE symbol = ${target.symbol} AND exchange = ${target.exchange})
        ORDER BY price
      `;
      const tRow = await prisma.$queryRaw<{ t: Date | null }[]>`
        SELECT max(t) AS t FROM "ObSnapshot" WHERE symbol = ${target.symbol} AND exchange = ${target.exchange}
      `;
      preview = { symbol: target.symbol, exchange: target.exchange, t: tRow[0]?.t ?? null, bins };
    }

    return NextResponse.json({ now: new Date().toISOString(), feeds, series, tableStats, collector, preview });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
