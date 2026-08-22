import { randomBytes } from "crypto";
import { prisma } from '@/lib/db';
import { computeMetrics } from '@/lib/analytics/metrics';
import type { RoundTripTrade, TradeSide, TradeResult } from '@/lib/analytics/types';

// High-entropy, URL-safe token — the ONLY credential for a share link (no
// user id in the URL, never enumerable). 24 bytes = 192 bits.
export function generateShareToken(): string {
  return randomBytes(24).toString("hex");
}

// Deliberately independent from /api/stats's buildBase(): a mentor snapshot
// only needs the big-picture numbers (no per-tag filters, no annotations), so
// this stays simple rather than threading an unauthenticated request through
// the full authenticated stats pipeline.
export async function computePublicSummary(
  userId: string,
  accountId?: string | null,
  range?: ShareRange | null,
) {
  // select строго под то, что читает computeMetrics ниже: без него findMany
  // тянул ВСЕ колонки обеих таблиц по всей истории пользователя — а ссылку
  // может открыть кто угодно, у кого она есть, сколько угодно раз.
  //
  // accountId сужает ссылку до одного счёта (NULL в ShareLink = все счета).
  // Счёт всё равно ищем среди счетов ВЛАДЕЛЬЦА ссылки: если его успели
  // удалить или он вообще чужой, findMany вернёт пусто — и страница покажет
  // пустую сводку вместо чужих сделок.
  const accountRows = await prisma.exchangeAccount.findMany({
    where: accountId ? { userId, id: accountId } : { userId },
    select: { id: true, balance: true },
  });
  const accountIds = accountRows.map((a) => a.id);
  // Период сужает выборку по времени ВЫХОДА из сделки — по нему же считается
  // и порядок в журнале.
  const inPeriod = exitTimeFilter(range);
  const [tradeRows, importedRows] = await Promise.all([
    prisma.trade.findMany({
      where: { accountId: { in: accountIds }, ...(inPeriod ? { exitTime: inPeriod } : {}) },
      orderBy: { exitTime: "asc" },
      select: {
        id: true, symbol: true, base: true, quote: true, market: true, exchange: true,
        accountId: true, side: true, entryTime: true, exitTime: true, qty: true,
        entryPrice: true, exitPrice: true, grossPnl: true, fees: true, netPnl: true,
        returnPct: true, fillCount: true, result: true, rr: true,
      },
    }),
    prisma.importedTrade.findMany({
      where: { accountId: { in: accountIds }, ...(inPeriod ? { exitTime: inPeriod } : {}) },
      orderBy: { exitTime: "asc" },
      select: {
        accountId: true, externalId: true, symbol: true, base: true, quote: true,
        market: true, source: true, side: true, entryTime: true, exitTime: true,
        qty: true, entryPrice: true, exitPrice: true, grossProfit: true, swap: true,
        netPnl: true, commission: true, lots: true, pips: true, rr: true,
      },
    }),
  ]);
  const accounts = accountRows;

  const cryptoTrades: RoundTripTrade[] = tradeRows.map((r) => (
    {
      id: r.id,
      symbol: r.symbol,
      base: r.base,
      quote: r.quote,
      market: r.market,
      exchange: r.exchange,
      accountId: r.accountId,
      side: r.side as TradeSide,
      entryTime: r.entryTime,
      exitTime: r.exitTime,
      durationMs: r.exitTime.getTime() - r.entryTime.getTime(),
      qty: r.qty,
      entryPrice: r.entryPrice,
      exitPrice: r.exitPrice,
      grossPnl: r.grossPnl,
      fees: r.fees,
      netPnl: r.netPnl,
      returnPct: r.returnPct,
      fillCount: r.fillCount,
      result: r.result as TradeResult,
      rr: r.rr,
    }
  ));

  const importedTrades: RoundTripTrade[] = importedRows.map((it) => (
    {
      id: `${it.accountId}:${it.externalId}`,
      symbol: it.symbol,
      base: it.base,
      quote: it.quote,
      market: it.market,
      exchange: it.source,
      accountId: it.accountId,
      side: it.side as TradeSide,
      entryTime: it.entryTime,
      exitTime: it.exitTime,
      durationMs: it.exitTime.getTime() - it.entryTime.getTime(),
      qty: it.qty,
      entryPrice: it.entryPrice,
      exitPrice: it.exitPrice,
      grossPnl: it.grossProfit + it.swap,
      fees: it.commission,
      netPnl: it.netPnl,
      returnPct: 0,
      fillCount: 1,
      result: it.netPnl > 1e-9 ? "win" : it.netPnl < -1e-9 ? "loss" : "breakeven",
      lots: it.lots,
      pips: it.pips,
      swap: it.swap,
      rr: it.rr,
    }
  ));

  const trades = [...cryptoTrades, ...importedTrades].sort(
    (a, b) => a.exitTime.getTime() - b.exitTime.getTime(),
  );
  const capital = accounts.reduce((s, a) => s + (a.balance ?? 0), 0) || 10000;
  const metrics = computeMetrics(trades, capital);

  return {
    totalTrades: trades.length,
    winRate: metrics.winRate,
    profitFactor: metrics.profitFactor,
    netPnl: metrics.totalNetPnl,
    expectancy: metrics.expectancy,
    maxDrawdownPct: metrics.maxDrawdownPct,
    equityCurve: metrics.equityCurve,
    firstTradeAt: trades[0]?.entryTime.toISOString() ?? null,
    lastTradeAt: trades[trades.length - 1]?.exitTime.toISOString() ?? null,
  };
}



// ─── Срок жизни ссылки ──────────────────────────────────────────────────────

/** Единицы, в которых задаётся срок при создании ссылки. */
export const TTL_UNITS = ["forever", "hours", "days"] as const;
export type TtlUnit = (typeof TTL_UNITS)[number];

/**
 * Разумные потолки: год в часах и десять лет в днях.
 *
 * Не про безопасность, а против опечаток — «10000 дней» почти наверняка промах
 * по клавише, а не намерение.
 */
export const TTL_MAX = { hours: 8760, days: 3650 } as const;

/**
 * Момент истечения ссылки или null для бессрочной.
 *
 * Часы и дни считаются от «сейчас»: ссылка на 48 часов живёт двое суток с
 * момента создания, а не до конца вторых суток.
 */
export function expiryFrom(
  unit: string | null | undefined,
  value: number | null | undefined,
  now = Date.now(),
): Date | null {
  if (unit !== "hours" && unit !== "days") return null;
  if (!value || !Number.isFinite(value) || value < 1) return null;
  const capped = Math.min(Math.floor(value), TTL_MAX[unit]);
  const ms = unit === "hours" ? capped * 3_600_000 : capped * 86_400_000;
  return new Date(now + ms);
}

/** Истекла ли ссылка. Бессрочная — никогда. */
export function isExpired(expiresAt: Date | null | undefined, now = Date.now()): boolean {
  return !!expiresAt && expiresAt.getTime() <= now;
}

// ─── Период отбора ──────────────────────────────────────────────────────────

/** Границы периода менторской ссылки; null с любой стороны = без границы. */
export type ShareRange = { from?: Date | null; to?: Date | null };

/**
 * Условие Prisma по времени ВЫХОДА из сделки — по нему же строится журнал.
 * Возвращает undefined, когда границ нет: тогда фильтр в запрос не попадает.
 */
export function exitTimeFilter(range?: ShareRange | null) {
  if (!range?.from && !range?.to) return undefined;
  return {
    ...(range.from ? { gte: range.from } : {}),
    // periodTo хранится как начало следующих суток, поэтому строгое «меньше».
    ...(range.to ? { lt: range.to } : {}),
  };
}

/**
 * Дата из календаря (YYYY-MM-DD) в границу периода.
 *
 * Конец диапазона — начало следующих суток: в календаре выбирают день целиком,
 * и сделка, закрытая в 23:30 последнего дня, должна попасть в выборку.
 */
export function parseRangeDate(raw: string | null | undefined, edge: "from" | "to"): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const at = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(at)) return null;
  return new Date(edge === "to" ? at + 86_400_000 : at);
}

/** Обратно в YYYY-MM-DD — для подписи и для значения в календаре. */
export function formatRangeDate(value: Date | null | undefined, edge: "from" | "to"): string {
  if (!value) return "";
  const ms = value.getTime() - (edge === "to" ? 86_400_000 : 0);
  return new Date(ms).toISOString().slice(0, 10);
}

// ─── Список сделок для менторской ссылки ────────────────────────────────────

/**
 * Сколько сделок отдаём на менторскую страницу.
 *
 * Ссылку открывает кто угодно и сколько угодно раз, а страница считается на
 * сервере при каждом заходе — отдавать весь журнал целиком нельзя. Берём
 * последние сделки: разбор идёт по свежим, а не по позапрошлогодним.
 */
export const PUBLIC_TRADES_LIMIT = 500;

export type PublicTrade = {
  id: string;
  symbol: string;
  side: string;
  market: string;
  entryTime: string;
  exitTime: string;
  durationMs: number;
  entryPrice: number;
  exitPrice: number;
  returnPct: number | null;
  rr: number | null;
  result: TradeResult;
  /** Публичная ссылка на скриншот или null. Денег в ней нет — это картинка. */
  imageUrl: string | null;
  // Разбор сделки, который трейдер вёл для себя (TradeAnnotation). Ради него
  // ментор и открывает ссылку: что за паттерн, где вход, какая ошибка.
  stopLoss: number | null;
  entryPoint: string | null;
  entryType: string | null;
  pattern: string | null;
  mistake: string | null;
  note: string | null;
};

export type PublicAccountTrades = {
  accountId: string;
  label: string;
  exchange: string;
  trades: PublicTrade[];
};

/**
 * Сделки для менторской страницы — по счетам, без единой денежной величины.
 *
 * Ментор смотрит на структуру сделки (что, куда, когда, сколько R) и на
 * скриншот, а размер счёта и заработок — не его дело: netPnl, комиссии и
 * объём НЕ выбираются из базы вовсе, чтобы их нельзя было достать ни из
 * разметки страницы, ни из полезной нагрузки RSC.
 */
// Пока аннотация не подтянута — все поля разбора пустые.
const EMPTY_NOTES = {
  imageUrl: null,
  stopLoss: null,
  entryPoint: null,
  entryType: null,
  pattern: null,
  mistake: null,
  note: null,
} satisfies Pick<PublicTrade, "imageUrl" | "stopLoss" | "entryPoint" | "entryType" | "pattern" | "mistake" | "note">;

export async function computePublicTrades(
  userId: string,
  accountId?: string | null,
  range?: ShareRange | null,
): Promise<PublicAccountTrades[]> {
  // Ссылка может быть на один счёт (accountId) или на все сразу (null) — см.
  // ShareLink.accountId. Условие по userId остаётся в любом случае: иначе
  // подставленный чужой accountId открыл бы чужие сделки.
  const accounts = await prisma.exchangeAccount.findMany({
    where: accountId ? { userId, id: accountId } : { userId },
    select: { id: true, label: true, exchange: true },
    orderBy: { createdAt: "asc" },
  });
  if (accounts.length === 0) return [];
  const accountIds = accounts.map((a) => a.id);

  const inPeriod = exitTimeFilter(range);
  const [tradeRows, importedRows] = await Promise.all([
    prisma.trade.findMany({
      where: { accountId: { in: accountIds }, ...(inPeriod ? { exitTime: inPeriod } : {}) },
      orderBy: { exitTime: "desc" },
      take: PUBLIC_TRADES_LIMIT,
      select: {
        id: true, accountId: true, symbol: true, market: true, side: true,
        entryTime: true, exitTime: true, entryPrice: true, exitPrice: true,
        returnPct: true, rr: true, result: true,
      },
    }),
    prisma.importedTrade.findMany({
      where: { accountId: { in: accountIds }, ...(inPeriod ? { exitTime: inPeriod } : {}) },
      orderBy: { exitTime: "desc" },
      take: PUBLIC_TRADES_LIMIT,
      select: {
        accountId: true, externalId: true, symbol: true, market: true, side: true,
        entryTime: true, exitTime: true, entryPrice: true, exitPrice: true,
        rr: true, netPnl: true,
      },
    }),
  ]);

  const rows: (PublicTrade & { accountId: string })[] = [
    ...tradeRows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      symbol: r.symbol,
      side: r.side,
      market: r.market,
      entryTime: r.entryTime.toISOString(),
      exitTime: r.exitTime.toISOString(),
      durationMs: r.exitTime.getTime() - r.entryTime.getTime(),
      entryPrice: r.entryPrice,
      exitPrice: r.exitPrice,
      returnPct: r.returnPct,
      rr: r.rr,
      result: r.result as TradeResult,
      ...EMPTY_NOTES,
    })),
    ...importedRows.map((it) => ({
      // Тот же составной ключ, что и у аннотаций (см. TradeAnnotation.tradeKey).
      id: `${it.accountId}:${it.externalId}`,
      accountId: it.accountId,
      symbol: it.symbol,
      side: it.side,
      market: it.market,
      entryTime: it.entryTime.toISOString(),
      exitTime: it.exitTime.toISOString(),
      durationMs: it.exitTime.getTime() - it.entryTime.getTime(),
      entryPrice: it.entryPrice,
      exitPrice: it.exitPrice,
      // Доходность в процентах для импортированных не считается (см.
      // computePublicSummary) — колонка останется пустой.
      returnPct: null,
      rr: it.rr,
      // Знак netPnl нужен только чтобы назвать сделку прибыльной или убыточной;
      // сама величина наружу не уходит.
      result: (it.netPnl > 1e-9 ? "win" : it.netPnl < -1e-9 ? "loss" : "breakeven") as TradeResult,
      ...EMPTY_NOTES,
    })),
  ]
    .sort((a, b) => Date.parse(b.exitTime) - Date.parse(a.exitTime))
    .slice(0, PUBLIC_TRADES_LIMIT);

  // Скриншоты. Берём imagePublicUrl, а не imageUrl: второй у части провайдеров
  // указывает на наш прокси, который требует сессии, — на публичной странице
  // такая картинка не откроется.
  const notes = await prisma.tradeAnnotation.findMany({
    where: { userId, tradeKey: { in: rows.map((r) => r.id) } },
    select: {
      tradeKey: true, imagePublicUrl: true, stopLoss: true,
      entryPoint: true, entryType: true, pattern: true, mistake: true, note: true,
    },
  });
  const noteByKey = new Map(notes.map((n) => [n.tradeKey, n]));
  for (const r of rows) {
    const n = noteByKey.get(r.id);
    if (!n) continue;
    r.imageUrl = n.imagePublicUrl;
    r.stopLoss = n.stopLoss;
    r.entryPoint = n.entryPoint;
    r.entryType = n.entryType;
    r.pattern = n.pattern;
    r.mistake = n.mistake;
    r.note = n.note;
  }

  const byAccount = new Map<string, PublicTrade[]>();
  for (const { accountId, ...trade } of rows) {
    const list = byAccount.get(accountId);
    if (list) list.push(trade);
    else byAccount.set(accountId, [trade]);
  }

  // Счета в порядке подключения; пустые не показываем — там нечего разбирать.
  return accounts
    .filter((a) => byAccount.has(a.id))
    .map((a) => ({ accountId: a.id, label: a.label, exchange: a.exchange, trades: byAccount.get(a.id) ?? [] }));
}
