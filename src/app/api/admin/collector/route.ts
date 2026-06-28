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

export async function GET(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  const url = new URL(req.url);
  const previewSymbol = url.searchParams.get("symbol");
  const previewExchange = url.searchParams.get("exchange");

  try {
    const [feeds, series, tableStats, collector] = await Promise.all([
      // Свежесть и объёмы по каждому фиду (symbol × exchange) из ObSnapshot.
      prisma.$queryRaw<FeedRow[]>`
        SELECT symbol, exchange,
          count(*)::int AS total,
          count(*) FILTER (WHERE t > now() - interval '1 minute')::int AS last_min,
          count(*) FILTER (WHERE t > now() - interval '1 hour')::int AS last_hour,
          max(t) AS last_t, min(t) AS oldest_t
        FROM "ObSnapshot"
        GROUP BY symbol, exchange
        ORDER BY symbol, exchange
      `,
      // Темп наполнения: снимков в минуту по биржам за последний час.
      prisma.$queryRaw<SeriesRow[]>`
        SELECT exchange, date_trunc('minute', t) AS minute, count(*)::int AS c
        FROM "ObSnapshot"
        WHERE t > now() - interval '60 minutes'
        GROUP BY exchange, minute
        ORDER BY minute
      `,
      // Счётчики остальных таблиц карты ордеров за последнюю минуту + свежесть.
      prisma.$queryRaw<{ tbl: string; last_min: number; last_t: Date | null }[]>`
        SELECT 'ObTrade' AS tbl,
          count(*) FILTER (WHERE t > now() - interval '1 minute')::int AS last_min,
          max(t) AS last_t FROM "ObTrade"
        UNION ALL
        SELECT 'ObFootprint',
          count(*) FILTER (WHERE t > now() - interval '1 minute')::int,
          max(t) FROM "ObFootprint"
        UNION ALL
        SELECT 'ObBigTrade',
          count(*) FILTER (WHERE t > now() - interval '1 minute')::int,
          max(t) FROM "ObBigTrade"
      `,
      fetchCollectorMetrics(),
    ]);

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
