import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AnalyticsPage from "../page";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    locale: "ru",
    timezone: "auto",
    setLocale: vi.fn(),
    setTimezone: vi.fn(),
  }),
}));

vi.mock("@/components/charts.lazy", () => ({
  EquityChart: () => <div data-testid="equity-chart" />,
  DrawdownChart: () => <div data-testid="drawdown-chart" />,
  Histogram: ({ data }: { data: unknown[] }) => (
    <div data-testid="histogram" data-bins={JSON.stringify(data)}>
      {data.length} bins
    </div>
  ),
}));

vi.mock("@/components/ExitEfficiencyCard", () => ({
  ExitEfficiencyCard: () => <div data-testid="exit-efficiency-card" />,
}));

vi.mock("@/components/MonteCarloCard", () => ({
  MonteCarloCard: () => <div data-testid="monte-carlo-card" />,
}));

function makeTrade(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "t1",
    symbol: "BTCUSDT",
    base: "BTC",
    quote: "USDT",
    market: "spot",
    exchange: "binance",
    accountId: "acc-1",
    side: "long",
    entryTime: "2024-01-01T00:00:00Z",
    exitTime: "2024-01-01T01:00:00Z",
    durationMs: 3600_000,
    qty: 1,
    entryPrice: 100,
    exitPrice: 110,
    grossPnl: 10,
    fees: 1,
    netPnl: 9,
    returnPct: 9,
    fillCount: 2,
    result: "win",
    entryPoint: null,
    entryType: null,
    mistake: null,
    pattern: null,
    stopLoss: 95,
    note: null,
    imageUrl: null,
    imageProvider: null,
    imagePublicUrl: null,
    ...overrides,
  };
}

// Корзины R теперь считает сервер — тест проверяет, что страница рисует
// именно ТО, что пришло, а не пересчитывает сама.
const R_BINS_25 = [
  { label: "1…2", count: 0, tone: "loss" },
  { label: "2…3", count: 1, tone: "profit" },
];

function makeStatsResponse(trades: unknown[], bins: unknown[] = R_BINS_25) {
  return {
    metrics: {
      tradeCount: trades.length,
      pnlBins: [{ label: "0", count: trades.length, tone: "profit" }],
      rBins: bins,
      holdBins: [{ label: "< 1h", count: trades.length, tone: "neutral" }],
      trend: null,
      scopeAccounts: [{ accountId: "acc-1", exchange: "binance" }],
      sharpe: 1.2,
      sortino: 1.5,
      calmar: 0.8,
      profitFactor: 1.9,
      avgRR: 0.5,
      recoveryFactor: 2.1,
      equityCurve: [{ t: 1, equity: 10000, pnl: 0 }],
    },
    fillCount: trades.length,
    symbols: ["BTCUSDT"],
    accounts: [{ id: "acc-1", label: "Main", exchange: "binance", balance: 10000 }],
    entryPointOptions: [],
    entryTypeOptions: [],
    mistakeOptions: [],
    patternOptions: [],
  };
}

describe("AnalyticsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any;
    render(<AnalyticsPage />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("shows empty state when there are no trades", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.startsWith("/api/stats")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(makeStatsResponse([])) });
      }
      if (url.startsWith("/api/accounts")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    }) as any;

    render(<AnalyticsPage />);
    await waitFor(() => expect(screen.getByText("dash.empty.noTradesText")).toBeInTheDocument());
  });

  it("renders metrics, charts and account selector after loading", async () => {
    const trades = [makeTrade(), makeTrade({ id: "t2", netPnl: -5, exitPrice: 90, side: "long" })];
    global.fetch = vi.fn((url: string) => {
      if (url.startsWith("/api/stats")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(makeStatsResponse(trades)) });
      }
      if (url.startsWith("/api/accounts")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: "acc-1", capital: 5000 }]),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    }) as any;

    render(<AnalyticsPage />);

    await waitFor(() => expect(screen.getByTestId("equity-chart")).toBeInTheDocument());
    expect(screen.getByTestId("drawdown-chart")).toBeInTheDocument();
    expect(screen.getAllByTestId("histogram").length).toBe(3);
    expect(screen.getByTestId("exit-efficiency-card")).toBeInTheDocument();
    expect(screen.getByTestId("monte-carlo-card")).toBeInTheDocument();
    expect(screen.getByText("1.90")).toBeInTheDocument(); // profitFactor via fmtRatio
    expect(screen.getByText("Main (binance)")).toBeInTheDocument();
  });

  it("рисует корзины R из ответа сервера, ничего не пересчитывая", async () => {
    const trades = [makeTrade({ rr: 2.5 })];
    global.fetch = vi.fn((url: string) => {
      if (url.startsWith("/api/stats")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(makeStatsResponse(trades)) });
      }
      if (url.startsWith("/api/accounts")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: "acc-1", capital: 5000 }]) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    }) as any;

    render(<AnalyticsPage />);
    await waitFor(() => expect(screen.getByTestId("equity-chart")).toBeInTheDocument());

    // Второй Histogram на странице — распределение R.
    const raw = screen.getAllByTestId("histogram")[1].getAttribute("data-bins")!;
    const bins = JSON.parse(raw) as { label: string; count: number }[];
    const byLabel = Object.fromEntries(bins.map((b) => [b.label, b.count]));
    expect(byLabel["2…3"]).toBe(1);
    expect(byLabel["1…2"]).toBe(0);
  });

  it("пустые корзины с сервера рисуются как пустые", async () => {
    const trades = [makeTrade({ rr: null })];
    global.fetch = vi.fn((url: string) => {
      if (url.startsWith("/api/stats")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(makeStatsResponse(trades, [])) });
      }
      if (url.startsWith("/api/accounts")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: "acc-1", capital: 5000 }]) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    }) as any;

    render(<AnalyticsPage />);
    await waitFor(() => expect(screen.getByTestId("equity-chart")).toBeInTheDocument());

    const raw = screen.getAllByTestId("histogram")[1].getAttribute("data-bins")!;
    expect(JSON.parse(raw)).toEqual([]);
  });

  it("refetches stats when account selector changes", async () => {
    const trades = [makeTrade()];
    global.fetch = vi.fn((url: string) => {
      if (url.startsWith("/api/stats")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(makeStatsResponse(trades)) });
      }
      if (url.startsWith("/api/accounts")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: "acc-1", capital: 5000 }]),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    }) as any;

    render(<AnalyticsPage />);
    await waitFor(() => expect(screen.getByTestId("equity-chart")).toBeInTheDocument());

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "acc-1" } });

    await waitFor(() => {
      const calls = (global.fetch as any).mock.calls.map((c: any[]) => c[0] as string);
      expect(calls.some((u: string) => u.includes("accountId=acc-1"))).toBe(true);
    });
  });
});
