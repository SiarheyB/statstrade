import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TradesPage from "../page";
import type { StatsResponse, SerializedTrade } from "@/lib/types";

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

const mockSyncAll = vi.fn();
let syncState = { anySyncing: false, completedAt: 0 };
vi.mock("@/components/SyncProvider", () => ({
  useSync: () => ({
    anySyncing: syncState.anySyncing,
    completedAt: syncState.completedAt,
    syncAll: mockSyncAll,
  }),
}));

vi.mock("@/components/charts.lazy", () => ({
  TradeChart: () => <div>mocked-trade-chart</div>,
}));
vi.mock("@/components/TradeImageCell", () => ({
  default: () => <div>mocked-trade-image-cell</div>,
}));
vi.mock("@/components/ImagePreviewModal", () => ({
  default: () => <div>mocked-image-preview</div>,
}));

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
    entryTime: "2026-07-01T10:00:00.000Z",
    exitTime: "2026-07-01T12:00:00.000Z",
    durationMs: 7200000,
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
    stopLoss: null,
    note: null,
    imageUrl: null,
    imageProvider: null,
    imagePublicUrl: null,
    ...overrides,
  } as SerializedTrade;
}

function makeStats(trades: SerializedTrade[]): StatsResponse {
  return {
    metrics: {} as StatsResponse["metrics"],
    trades,
    fillCount: trades.length,
    symbols: [...new Set(trades.map((t) => t.symbol))],
    accounts: [{ id: "acc1", label: "My Account", exchange: "binance", balance: 1000 }],
    entryPointOptions: [],
    entryTypeOptions: [],
    mistakeOptions: [],
    patternOptions: [],
  };
}

function jsonRes(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  syncState = { anySyncing: false, completedAt: 0 };
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:mock");
  } else {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
  }
  global.fetch = vi.fn((url: string) => {
    if (url === "/api/stats") return jsonRes(makeStats([]));
    if (url === "/api/integrations/google-drive") return jsonRes({ connected: false });
    if (url === "/api/integrations/yandex-disk") return jsonRes({ connected: false });
    if (url === "/api/risk/settings") return jsonRes({ profiles: {} });
    return jsonRes({});
  }) as unknown as typeof fetch;
});

describe("TradesPage", () => {
  it("shows loading state initially", () => {
    render(<TradesPage />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("shows empty state when there are no trades", async () => {
    render(<TradesPage />);
    expect(await screen.findByText("trades.empty")).toBeInTheDocument();
  });

  it("renders trades once loaded", async () => {
    const trade = makeTrade();
    global.fetch = vi.fn((url: string) => {
      if (url === "/api/stats") return jsonRes(makeStats([trade]));
      return jsonRes({ connected: false });
    }) as unknown as typeof fetch;

    render(<TradesPage />);
    expect(await screen.findByText("BTCUSDT")).toBeInTheDocument();
  });

  it("expands a trade row on click to show detail fields", async () => {
    const trade = makeTrade();
    global.fetch = vi.fn((url: string) => {
      if (url === "/api/stats") return jsonRes(makeStats([trade]));
      return jsonRes({ connected: false });
    }) as unknown as typeof fetch;

    render(<TradesPage />);
    const row = (await screen.findByText("BTCUSDT")).closest("tr");
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    expect(await screen.findByText("mocked-trade-image-cell")).toBeInTheDocument();
  });

  it("filters trades by side", async () => {
    const longTrade = makeTrade({ id: "t-long", symbol: "LONGCOIN", side: "long" });
    const shortTrade = makeTrade({ id: "t-short", symbol: "SHORTCOIN", side: "short" });
    global.fetch = vi.fn((url: string) => {
      if (url === "/api/stats") return jsonRes(makeStats([longTrade, shortTrade]));
      return jsonRes({ connected: false });
    }) as unknown as typeof fetch;

    render(<TradesPage />);
    await screen.findByText("LONGCOIN");
    expect(screen.getByText("SHORTCOIN")).toBeInTheDocument();

    const sideSelect = screen.getByDisplayValue("Long + Short");
    fireEvent.change(sideSelect, { target: { value: "long" } });

    await waitFor(() => {
      expect(screen.queryByText("SHORTCOIN")).not.toBeInTheDocument();
    });
    expect(screen.getByText("LONGCOIN")).toBeInTheDocument();
  });

  it("sorts trades by clicking a sortable column header", async () => {
    const t1 = makeTrade({ id: "t1", symbol: "AAA", netPnl: 5 });
    const t2 = makeTrade({ id: "t2", symbol: "BBB", netPnl: 50 });
    global.fetch = vi.fn((url: string) => {
      if (url === "/api/stats") return jsonRes(makeStats([t1, t2]));
      return jsonRes({ connected: false });
    }) as unknown as typeof fetch;

    render(<TradesPage />);
    await screen.findByText("AAA");
    const netPnlHeader = screen.getByText("trades.col.netPnl");
    fireEvent.click(netPnlHeader);
    fireEvent.click(netPnlHeader);
    // Just verify no crash and rows still present after re-sort toggling
    expect(screen.getByText("AAA")).toBeInTheDocument();
    expect(screen.getByText("BBB")).toBeInTheDocument();
  });

  it("triggers syncAll when clicking the sync button", async () => {
    render(<TradesPage />);
    await screen.findByText("trades.empty");
    fireEvent.click(screen.getByText("trades.syncAll"));
    expect(mockSyncAll).toHaveBeenCalled();
  });

  it("calls exportCsv download flow when clicking csv button", async () => {
    const trade = makeTrade();
    global.fetch = vi.fn((url: string) => {
      if (url === "/api/stats") return jsonRes(makeStats([trade]));
      return jsonRes({ connected: false });
    }) as unknown as typeof fetch;
    render(<TradesPage />);
    await screen.findByText("BTCUSDT");
    // downloadCsv relies on DOM APIs; just ensure clicking doesn't throw
    expect(() => fireEvent.click(screen.getByText("trades.csv"))).not.toThrow();
  });
});
