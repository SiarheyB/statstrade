// Область расчёта Exit efficiency — какие сделки попадают в сводку.
//
// Сам расчёт MFE/MAE ОТСЮДА УБРАН: он делался в браузере (до maxTrades запросов
// к публичному API биржи за свечами на каждый клик «Посчитать») и никуда не
// сохранялся. Теперь MFE/MAE считаются один раз фоново и лежат в БД —
// см. lib/analytics/mfe.ts и /api/exit-efficiency. Здесь остался только выбор
// сделок для подписи «область расчёта» в карточке.

import type { SerializedTrade } from "@/lib/types";
import { isExchangeId } from "@/lib/exchangeIds";

// Most recent trades first — that's what a trader cares about improving
// next. Exported so the UI can show which trades/exchanges are actually in
// scope *before* running the (expensive) analysis, not just after.
//
// Imported forex/MT4/MT5/manual trades are excluded up front: their
// `exchange` is the import source ("mt4"/"mt5"/"manual"), not a real ccxt
// exchange, so /api/trade-chart has no public candle source for them and
// would always fail. Filtering them out here — instead of letting them
// occupy a slot in the "last maxTrades" window and silently fail later —
// means that budget goes to trades that can actually be analyzed.
export function pickRecentTrades(allTrades: SerializedTrade[], maxTrades: number): SerializedTrade[] {
  return [...allTrades]
    .filter((t) => isExchangeId(t.exchange))
    .sort((a, b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime())
    .slice(0, Math.max(1, maxTrades));
}
