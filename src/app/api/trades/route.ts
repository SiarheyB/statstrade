import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { ensureAccountTrades } from "@/lib/analytics/materialize";
import {
  queryTrades,
  querySymbols,
  TRADE_SORTS,
  type TradeSort,
  type TradeFilters,
} from "@/lib/analytics/tradeList";

// Постраничный список сделок для /dashboard/trades.
//
// Раньше страница дёргала /api/stats БЕЗ параметров: сервер считал ~60 метрик и
// кривую капитала (страница не использует из них ничего), а в браузер уезжала
// вся история сделок целиком — ради 25 строк на экране. Здесь фильтры,
// сортировка и пагинация выполняются в Postgres.
//
// Словари тегов отдаёт /api/settings, счета — /api/accounts; здесь они не
// дублируются. Список тикеров для фильтра требует прохода по сделкам, поэтому
// считается только по запросу (withMeta=1) — страница просит его один раз при
// монтировании, а не на каждое перелистывание.

const MAX_PAGE_SIZE = 200;

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const p = (key: string, fallback = "all") => url.searchParams.get(key) ?? fallback;

  const filters: TradeFilters = {
    accountId: p("accountId"),
    symbol: p("symbol"),
    market: p("market"),
    side: p("side"),
    result: p("result"),
    entryPoint: p("entryPoint"),
    entryType: p("entryType"),
    mistake: p("mistake"),
    pattern: p("pattern"),
  };

  const sortParam = url.searchParams.get("sort") ?? "exitTime";
  const sort: TradeSort = (TRADE_SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as TradeSort)
    : "exitTime";
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";

  // all=1 — выгрузка в CSV: там нужен весь отфильтрованный набор, а не страница.
  const all = url.searchParams.get("all") === "1";
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);
  const pageSizeRaw = Number(url.searchParams.get("pageSize") ?? 25) || 25;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSizeRaw));

  try {
    // Бэкафилл материализованных сделок для аккаунтов, где он ещё не выполнялся
    // (тот же одноразовый путь, что в /api/stats и /api/risk).
    const accountRows = await prisma.exchangeAccount.findMany({
      where: { userId: user.userId },
      select: { id: true, tradesRebuiltAt: true },
    });
    await ensureAccountTrades(accountRows);

    const [result, symbols] = await Promise.all([
      queryTrades(user.userId, filters, sort, dir, all ? { all: true } : { page, pageSize }),
      url.searchParams.get("withMeta") === "1"
        ? querySymbols(user.userId)
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      trades: result.trades,
      total: result.total,
      page: all ? 0 : page,
      pageSize: all ? result.total : pageSize,
      ...(symbols ? { symbols } : {}),
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
