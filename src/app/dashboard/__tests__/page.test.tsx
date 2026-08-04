import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DashboardPage from "../page";
import type { StatsResponse, SerializedTrade } from "@/lib/types";
import type { Metrics } from "@/lib/analytics/metrics";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string, params?: Record<string, unknown>) =>
      params ? `${k}:${JSON.stringify(params)}` : k,
    locale: "ru",
    timezone: "auto",
    setLocale: vi.fn(),
    setTimezone: vi.fn(),
  }),
}));

vi.mock("@/components/charts.lazy", () => ({
  EquityChart: () => <div>mocked-equity-chart</div>,
  DailyPnlChart: () => <div>mocked-daily-pnl-chart</div>,
  BreakdownChart: () => <div>mocked-breakdown-chart</div>,
  PnlHeatmap: () => <div>mocked-pnl-heatmap</div>,
}));

vi.mock("@/components/RiskBanner", () => ({
  default: () => <div>mocked-risk-banner</div>,
}));

function makeMetrics(overrides: Partial<Metrics> = {}): Metrics {
  const base: Metrics = {
    initialCapital: 10000,
    totalNetPnl: 500,
    grossProfit: 800,
    grossLoss: 300,
    roiPct: 5,
    annualizedReturnPct: 20,
    finalEquity: 10500,
    totalVolume: 100000,
    avgTradePnl: 50,
    avgDailyPnl: 25,
    medianTrade: 40,
    bestTrade: 200,
    worstTrade: -100,
    tradeCount: 10,
    wins: 6,
    losses: 3,
    breakevens: 1,
    winRate: 60,
    lossRate: 30,
    profitFactor: 2.67,
    payoffRatio: 1.5,
    expectancy: 50,
    avgReturnPct: 2,
    avgWin: 133,
    avgLoss: 100,
    avgWinPct: 3,
    avgLossPct: -2,
    winLossRatio: 1.33,
    kellyPct: 10,
    recoveryFactor: 3,
    avgRR: 1.2,
    stdDevTradePnl: 50,
    largestWinStreak: 3,
    largestLossStreak: 2,
    maxDrawdown: 150,
    maxDrawdownPct: 1.5,
    avgDrawdownPct: 0.5,
    longestDrawdownDays: 2,
    sharpe: 1.1,
    sortino: 1.4,
    calmar: 2.2,
    volatilityPct: 5,
    downsideDevPct: 3,
    ulcerIndex: 0.5,
    longTrades: 6,
    shortTrades: 4,
    longWinRate: 66,
    shortWinRate: 50,
    longNetPnl: 300,
    shortNetPnl: 200,
    symbolsTraded: 2,
    avgTradesPerDay: 1,
    tradingDays: 10,
    winningDays: 6,
    losingDays: 4,
    percentWinningDays: 60,
    bestDayPnl: 150,
    worstDayPnl: -80,
    avgDurationMs: 3600000,
    avgWinDurationMs: 3000000,
    avgLossDurationMs: 4000000,
    totalFees: 20,
    avgFeePerTrade: 2,
    feesToProfitPct: 4,
    totalPips: 0,
    avgPips: 0,
    totalSwap: 0,
    totalCommission: 0,
    totalLots: 0,
    avgLot: 0,
    equityCurve: [{ t: Date.now(), equity: 10500, pnl: 500 }],
    daily: [
      { date: "2026-07-01", pnl: 100, cumulative: 100, trades: 2, winRate: 50, winR: 1, lossR: 0 },
    ],
    bySide: {
      long: { trades: 6, wins: 4, losses: 2, netPnl: 300, winRate: 66 },
      short: { trades: 4, wins: 2, losses: 2, netPnl: 200, winRate: 50 },
    },
    bySymbol: [{ symbol: "BTCUSDT", trades: 10, netPnl: 500, winRate: 60, volume: 1000 }],
    byDayOfWeek: [],
    byHour: [],
    byMonth: [],
    byExchange: [],
    byEntryPoint: [],
    byEntryType: [],
    byMistake: [],
    byPattern: [],
    bySession: [],
  };
  return { ...base, ...overrides };
}

function makeTrade(overrides: Partial<SerializedTrade> = {}): SerializedTrade {
  return {
    id: "t1",
    symbol: "BTCUSDT",
    base: "BTC",
    quote: "USDT",
    market: "spot",
    exchange: "binance",
    accountId: "acc1",
    side: "long",
    entryTime: new Date().toISOString(),
    exitTime: new Date().toISOString(),
    durationMs: 3600000,
    qty: 1,
    entryPrice: 100,
    exitPrice: 110,
    grossPnl: 10,
    fees: 1,
    netPnl: 9,
    returnPct: 9,
    fillCount: 1,
    result: "win",
    entryPoint: null,
    entryType: null,
    mistake: null,
    pattern: null,
    stopLoss: null,
    note: null,
    imageUrl: null,
    imageProvider: null,
    imagePublicUrl: null,
    ...overrides,
  } as SerializedTrade;
}

function makeStats(overrides: Partial<StatsResponse> = {}): StatsResponse {
  return {
    metrics: makeMetrics(),
    trades: [makeTrade()],
    fillCount: 1,
    symbols: ["BTCUSDT"],
    accounts: [{ id: "acc1", label: "My Account", exchange: "binance", balance: 1000 }],
    entryPointOptions: [],
    entryTypeOptions: [],
    mistakeOptions: [],
    patternOptions: [],
    ...overrides,
  };
}

function jsonRes(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn((url: string) => {
    if (url.toString().startsWith("/api/stats")) return jsonRes(makeStats());
    if (url === "/api/accounts") return jsonRes([{ id: "acc1", capital: 1000 }]);
    return jsonRes({});
  }) as unknown as typeof fetch;
});

describe("DashboardPage", () => {
  it("shows loading text while fetching", () => {
    render(<DashboardPage />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("shows an error message when the stats fetch fails", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.toString().startsWith("/api/stats"))
        return jsonRes({ error: "Boom" }, false);
      if (url === "/api/accounts") return jsonRes([]);
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<DashboardPage />);
    expect(await screen.findByText("Boom")).toBeInTheDocument();
  });

  it("shows connect-account empty state when there are no accounts", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.toString().startsWith("/api/stats"))
        return jsonRes(makeStats({ accounts: [], trades: [] }));
      return jsonRes([]);
    }) as unknown as typeof fetch;

    render(<DashboardPage />);
    expect(await screen.findByText("dash.empty.connectTitle")).toBeInTheDocument();
  });

  it("shows no-trades empty state when accounts exist but there are no trades", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.toString().startsWith("/api/stats"))
        return jsonRes(
          makeStats({
            trades: [],
            metrics: makeMetrics({ tradeCount: 0 }),
          }),
        );
      if (url === "/api/accounts") return jsonRes([{ id: "acc1", capital: 1000 }]);
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<DashboardPage />);
    expect(await screen.findByText("dash.empty.noTradesTitle")).toBeInTheDocument();
  });

  it("renders headline stats and charts once data loads", async () => {
    render(<DashboardPage />);
    expect(await screen.findByText("mocked-equity-chart")).toBeInTheDocument();
    expect(screen.getAllByText("mocked-breakdown-chart").length).toBeGreaterThan(0);
    expect(screen.getByText("mocked-risk-banner")).toBeInTheDocument();
  });

  it("changes market filter and triggers a reload", async () => {
    render(<DashboardPage />);
    await screen.findByText("mocked-equity-chart");
    const marketSelect = screen.getByDisplayValue("dash.allMarkets");
    fireEvent.change(marketSelect, { target: { value: "spot" } });
    await waitFor(() => {
      const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => (c[0] as string).toString());
      expect(calls.some((u) => u.includes("market=spot"))).toBe(true);
    });
  });

  it("toggles the daily pnl metric tab", async () => {
    render(<DashboardPage />);
    await screen.findByText("mocked-daily-pnl-chart");
    fireEvent.click(screen.getByText("metric.risk"));
    // no crash, chart remains rendered
    expect(screen.getByText("mocked-daily-pnl-chart")).toBeInTheDocument();
  });

  it("clicking refresh button re-fetches stats", async () => {
    render(<DashboardPage />);
    await screen.findByText("mocked-equity-chart");
    const callsBefore = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    fireEvent.click(screen.getByTitle("dash.refresh"));
    await waitFor(() => {
      expect((global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
