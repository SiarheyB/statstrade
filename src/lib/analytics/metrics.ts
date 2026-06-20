import type { RoundTripTrade, TradeSide } from "./types";
import { UNSET_LABEL } from "../annotations";

export type SideStats = {
  trades: number;
  netPnl: number;
  winRate: number;
  wins: number;
  losses: number;
};

export type SymbolStats = {
  symbol: string;
  trades: number;
  netPnl: number;
  winRate: number;
  volume: number;
};

export type Bucket = {
  key: string;
  label: string;
  trades: number;
  netPnl: number;
  winRate: number;
};

export type EquityPoint = { t: number; equity: number; pnl: number };
export type DailyPoint = { date: string; pnl: number; cumulative: number; trades: number };

export type Metrics = {
  initialCapital: number;
  // P&L
  totalNetPnl: number;
  grossProfit: number;
  grossLoss: number;
  roiPct: number;
  annualizedReturnPct: number;
  finalEquity: number;
  totalVolume: number;
  avgTradePnl: number;
  avgDailyPnl: number;
  medianTrade: number;
  bestTrade: number;
  worstTrade: number;
  // counts
  tradeCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  lossRate: number;
  // efficiency
  profitFactor: number;
  payoffRatio: number;
  expectancy: number; // avg net pnl per trade (quote)
  avgReturnPct: number;
  avgWin: number;
  avgLoss: number;
  avgWinPct: number;
  avgLossPct: number;
  winLossRatio: number;
  kellyPct: number;
  recoveryFactor: number;
  avgRR: number; // average realized R-multiple over trades with a stop-loss
  stdDevTradePnl: number;
  // streaks
  largestWinStreak: number;
  largestLossStreak: number;
  // risk
  maxDrawdown: number;
  maxDrawdownPct: number;
  avgDrawdownPct: number;
  longestDrawdownDays: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  volatilityPct: number;
  downsideDevPct: number;
  ulcerIndex: number;
  // sides
  longTrades: number;
  shortTrades: number;
  longWinRate: number;
  shortWinRate: number;
  longNetPnl: number;
  shortNetPnl: number;
  // activity
  symbolsTraded: number;
  avgTradesPerDay: number;
  tradingDays: number;
  winningDays: number;
  losingDays: number;
  percentWinningDays: number;
  bestDayPnl: number;
  worstDayPnl: number;
  // time
  avgDurationMs: number;
  avgWinDurationMs: number;
  avgLossDurationMs: number;
  // fees
  totalFees: number;
  avgFeePerTrade: number;
  feesToProfitPct: number;
  // series
  equityCurve: EquityPoint[];
  daily: DailyPoint[];
  // breakdowns
  bySide: Record<TradeSide, SideStats>;
  bySymbol: SymbolStats[];
  byDayOfWeek: Bucket[];
  byHour: Bucket[];
  byMonth: Bucket[];
  byExchange: Bucket[];
  byEntryPoint: Bucket[]; // ТВХ
  byEntryType: Bucket[];
  byMistake: Bucket[]; // ошибки
  byPattern: Bucket[]; // паттерн
};

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

const DOW = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTHS = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

function emptySide(): SideStats {
  return { trades: 0, netPnl: 0, winRate: 0, wins: 0, losses: 0 };
}

function bucketStats(
  trades: RoundTripTrade[],
  keyFn: (t: RoundTripTrade) => string,
  labelFn: (key: string) => string,
): Bucket[] {
  const map = new Map<string, { trades: number; netPnl: number; wins: number }>();
  for (const t of trades) {
    const key = keyFn(t);
    const b = map.get(key) ?? { trades: 0, netPnl: 0, wins: 0 };
    b.trades += 1;
    b.netPnl += t.netPnl;
    if (t.result === "win") b.wins += 1;
    map.set(key, b);
  }
  return Array.from(map.entries()).map(([key, b]) => ({
    key,
    label: labelFn(key),
    trades: b.trades,
    netPnl: b.netPnl,
    winRate: b.trades > 0 ? (b.wins / b.trades) * 100 : 0,
  }));
}

export function computeMetrics(
  trades: RoundTripTrade[],
  initialCapital = 10000,
): Metrics {
  const sorted = [...trades].sort(
    (a, b) => a.exitTime.getTime() - b.exitTime.getTime(),
  );

  const wins = sorted.filter((t) => t.result === "win");
  const losses = sorted.filter((t) => t.result === "loss");
  const breakevens = sorted.filter((t) => t.result === "breakeven");

  const grossProfit = wins.reduce((a, t) => a + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.netPnl, 0));
  const totalNetPnl = sorted.reduce((a, t) => a + t.netPnl, 0);
  const totalFees = sorted.reduce((a, t) => a + t.fees, 0);
  const totalVolume = sorted.reduce((a, t) => a + t.entryPrice * t.qty, 0);

  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  // streaks (chronological)
  let largestWinStreak = 0;
  let largestLossStreak = 0;
  let curWin = 0;
  let curLoss = 0;
  for (const t of sorted) {
    if (t.result === "win") {
      curWin += 1;
      curLoss = 0;
    } else if (t.result === "loss") {
      curLoss += 1;
      curWin = 0;
    } else {
      curWin = 0;
      curLoss = 0;
    }
    largestWinStreak = Math.max(largestWinStreak, curWin);
    largestLossStreak = Math.max(largestLossStreak, curLoss);
  }

  // equity curve
  const equityCurve: EquityPoint[] = [];
  let equity = initialCapital;
  if (sorted.length > 0) {
    equityCurve.push({ t: sorted[0].entryTime.getTime(), equity, pnl: 0 });
  }
  for (const t of sorted) {
    equity += t.netPnl;
    equityCurve.push({ t: t.exitTime.getTime(), equity, pnl: t.netPnl });
  }

  // max drawdown + underwater duration + ulcer index
  let peak = initialCapital;
  let peakTime = equityCurve[0]?.t ?? 0;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let longestDrawdownMs = 0;
  let ddSum = 0;
  let ddCount = 0;
  let ulcerSumSq = 0;
  for (const p of equityCurve) {
    if (p.equity >= peak) {
      peak = p.equity;
      peakTime = p.t;
    } else {
      const dd = peak - p.equity;
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
      longestDrawdownMs = Math.max(longestDrawdownMs, p.t - peakTime);
      ddSum += ddPct;
      ddCount += 1;
    }
    const curDdPct = peak > 0 ? ((peak - p.equity) / peak) * 100 : 0;
    ulcerSumSq += curDdPct * curDdPct;
  }
  const avgDrawdownPct = ddCount > 0 ? ddSum / ddCount : 0;
  const ulcerIndex = equityCurve.length
    ? Math.sqrt(ulcerSumSq / equityCurve.length)
    : 0;

  // daily P&L series and daily returns for Sharpe/Sortino
  const dayMap = new Map<string, { pnl: number; trades: number }>();
  for (const t of sorted) {
    const key = t.exitTime.toISOString().slice(0, 10);
    const d = dayMap.get(key) ?? { pnl: 0, trades: 0 };
    d.pnl += t.netPnl;
    d.trades += 1;
    dayMap.set(key, d);
  }
  const dailyKeys = Array.from(dayMap.keys()).sort();
  const daily: DailyPoint[] = [];
  const dailyReturns: number[] = [];
  let cum = 0;
  let runningEquity = initialCapital;
  for (const key of dailyKeys) {
    const d = dayMap.get(key)!;
    cum += d.pnl;
    daily.push({ date: key, pnl: d.pnl, cumulative: cum, trades: d.trades });
    if (runningEquity > 0) dailyReturns.push(d.pnl / runningEquity);
    runningEquity += d.pnl;
  }

  const meanDaily = mean(dailyReturns);
  const stdDaily = std(dailyReturns);
  const downside = std(dailyReturns.filter((r) => r < 0));
  const ANNUAL = Math.sqrt(365);
  const sharpe = stdDaily > 0 ? (meanDaily / stdDaily) * ANNUAL : 0;
  const sortino = downside > 0 ? (meanDaily / downside) * ANNUAL : 0;
  const volatilityPct = stdDaily * ANNUAL * 100;
  const downsideDevPct = downside * ANNUAL * 100;

  // annualized return (also used for Calmar)
  let annualizedReturnPct = 0;
  if (sorted.length > 0) {
    const first = sorted[0].entryTime.getTime();
    const last = sorted[sorted.length - 1].exitTime.getTime();
    const years = Math.max((last - first) / (365 * 24 * 3600 * 1000), 1 / 365);
    const totalReturn = totalNetPnl / initialCapital;
    annualizedReturnPct = (Math.pow(1 + totalReturn, 1 / years) - 1) * 100;
  }
  const calmar = maxDrawdownPct > 0 ? annualizedReturnPct / maxDrawdownPct : 0;

  // breakdowns by side
  const bySide: Record<TradeSide, SideStats> = {
    long: emptySide(),
    short: emptySide(),
  };
  for (const t of sorted) {
    const s = bySide[t.side];
    s.trades += 1;
    s.netPnl += t.netPnl;
    if (t.result === "win") s.wins += 1;
    else if (t.result === "loss") s.losses += 1;
  }
  for (const side of ["long", "short"] as TradeSide[]) {
    const s = bySide[side];
    s.winRate = s.trades > 0 ? (s.wins / s.trades) * 100 : 0;
  }

  // by symbol
  const symMap = new Map<
    string,
    { trades: number; netPnl: number; wins: number; volume: number }
  >();
  for (const t of sorted) {
    const b = symMap.get(t.symbol) ?? { trades: 0, netPnl: 0, wins: 0, volume: 0 };
    b.trades += 1;
    b.netPnl += t.netPnl;
    b.volume += t.entryPrice * t.qty;
    if (t.result === "win") b.wins += 1;
    symMap.set(t.symbol, b);
  }
  const bySymbol: SymbolStats[] = Array.from(symMap.entries())
    .map(([symbol, b]) => ({
      symbol,
      trades: b.trades,
      netPnl: b.netPnl,
      winRate: b.trades > 0 ? (b.wins / b.trades) * 100 : 0,
      volume: b.volume,
    }))
    .sort((a, b) => Math.abs(b.netPnl) - Math.abs(a.netPnl));

  const byDayOfWeek = bucketStats(
    sorted,
    (t) => String(t.exitTime.getUTCDay()),
    (k) => DOW[Number(k)],
  ).sort((a, b) => Number(a.key) - Number(b.key));

  const byHour = bucketStats(
    sorted,
    (t) => String(t.exitTime.getUTCHours()),
    (k) => `${k.padStart(2, "0")}:00`,
  ).sort((a, b) => Number(a.key) - Number(b.key));

  const byMonth = bucketStats(
    sorted,
    (t) => t.exitTime.toISOString().slice(0, 7),
    (k) => {
      const [y, m] = k.split("-");
      return `${MONTHS[Number(m) - 1]} ${y}`;
    },
  ).sort((a, b) => a.key.localeCompare(b.key));

  const byExchange = bucketStats(
    sorted,
    (t) => t.exchange,
    (k) => k.charAt(0).toUpperCase() + k.slice(1),
  ).sort((a, b) => b.netPnl - a.netPnl);

  const byEntryPoint = bucketStats(
    sorted,
    (t) => t.entryPoint || UNSET_LABEL,
    (k) => k,
  ).sort((a, b) => b.netPnl - a.netPnl);

  const byEntryType = bucketStats(
    sorted,
    (t) => t.entryType || UNSET_LABEL,
    (k) => k,
  ).sort((a, b) => b.netPnl - a.netPnl);

  const byMistake = bucketStats(
    sorted,
    (t) => t.mistake || UNSET_LABEL,
    (k) => k,
  ).sort((a, b) => a.netPnl - b.netPnl); // worst (most negative) first

  const byPattern = bucketStats(
    sorted,
    (t) => t.pattern || UNSET_LABEL,
    (k) => k,
  ).sort((a, b) => b.netPnl - a.netPnl);

  // derived scalars
  const tradeCount = sorted.length;
  const winRate = tradeCount > 0 ? (wins.length / tradeCount) * 100 : 0;
  const tradingDays = daily.length;
  const winningDays = daily.filter((d) => d.pnl > 0).length;
  const losingDays = daily.filter((d) => d.pnl < 0).length;
  const kellyFracPayoff = avgLoss > 0 ? avgWin / avgLoss : 0;
  const w = winRate / 100;
  const kellyPct =
    kellyFracPayoff > 0 ? (w - (1 - w) / kellyFracPayoff) * 100 : 0;

  // Average realized R-multiple (price-based, stop distance = 1R), over trades
  // with a stop-loss. Exiting at the stop is exactly -1R.
  const rMultiples: number[] = [];
  for (const tr of sorted) {
    if (tr.stopLoss == null) continue;
    const risk = Math.abs(tr.entryPrice - tr.stopLoss);
    if (risk <= 0) continue;
    const move =
      tr.side === "long" ? tr.exitPrice - tr.entryPrice : tr.entryPrice - tr.exitPrice;
    rMultiples.push(move / risk);
  }
  const avgRR = rMultiples.length ? mean(rMultiples) : 0;

  return {
    initialCapital,
    totalNetPnl,
    grossProfit,
    grossLoss,
    roiPct: initialCapital > 0 ? (totalNetPnl / initialCapital) * 100 : 0,
    annualizedReturnPct,
    finalEquity: initialCapital + totalNetPnl,
    totalVolume,
    avgTradePnl: tradeCount > 0 ? totalNetPnl / tradeCount : 0,
    avgDailyPnl: tradingDays > 0 ? totalNetPnl / tradingDays : 0,
    medianTrade: median(sorted.map((t) => t.netPnl)),
    bestTrade: sorted.length ? Math.max(...sorted.map((t) => t.netPnl)) : 0,
    worstTrade: sorted.length ? Math.min(...sorted.map((t) => t.netPnl)) : 0,
    tradeCount,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    winRate,
    lossRate: tradeCount > 0 ? (losses.length / tradeCount) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    payoffRatio: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0,
    expectancy: tradeCount > 0 ? totalNetPnl / tradeCount : 0,
    avgReturnPct: tradeCount > 0 ? mean(sorted.map((t) => t.returnPct)) : 0,
    avgWin,
    avgLoss,
    avgWinPct: wins.length ? mean(wins.map((t) => t.returnPct)) : 0,
    avgLossPct: losses.length ? mean(losses.map((t) => t.returnPct)) : 0,
    winLossRatio: losses.length ? wins.length / losses.length : wins.length > 0 ? Infinity : 0,
    kellyPct,
    recoveryFactor: maxDrawdown > 0 ? totalNetPnl / maxDrawdown : totalNetPnl > 0 ? Infinity : 0,
    avgRR,
    stdDevTradePnl: std(sorted.map((t) => t.netPnl)),
    largestWinStreak,
    largestLossStreak,
    maxDrawdown,
    maxDrawdownPct,
    avgDrawdownPct,
    longestDrawdownDays: longestDrawdownMs / (24 * 3600 * 1000),
    sharpe,
    sortino,
    calmar,
    volatilityPct,
    downsideDevPct,
    ulcerIndex,
    longTrades: bySide.long.trades,
    shortTrades: bySide.short.trades,
    longWinRate: bySide.long.winRate,
    shortWinRate: bySide.short.winRate,
    longNetPnl: bySide.long.netPnl,
    shortNetPnl: bySide.short.netPnl,
    symbolsTraded: bySymbol.length,
    avgTradesPerDay: tradingDays > 0 ? tradeCount / tradingDays : 0,
    tradingDays,
    winningDays,
    losingDays,
    percentWinningDays: tradingDays > 0 ? (winningDays / tradingDays) * 100 : 0,
    bestDayPnl: daily.length ? Math.max(...daily.map((d) => d.pnl)) : 0,
    worstDayPnl: daily.length ? Math.min(...daily.map((d) => d.pnl)) : 0,
    avgDurationMs: tradeCount > 0 ? mean(sorted.map((t) => t.durationMs)) : 0,
    avgWinDurationMs: wins.length ? mean(wins.map((t) => t.durationMs)) : 0,
    avgLossDurationMs: losses.length ? mean(losses.map((t) => t.durationMs)) : 0,
    totalFees,
    avgFeePerTrade: tradeCount > 0 ? totalFees / tradeCount : 0,
    feesToProfitPct: grossProfit > 0 ? (totalFees / grossProfit) * 100 : 0,
    equityCurve,
    daily,
    bySide,
    bySymbol,
    byDayOfWeek,
    byHour,
    byMonth,
    byExchange,
    byEntryPoint,
    byEntryType,
    byMistake,
    byPattern,
  };
}
