import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  EquityChart,
  DailyPnlChart,
  BreakdownChart,
  DrawdownChart,
  Histogram,
  PnlHeatmap,
  RHeatmap,
  TradeChart,
} from "@/components/charts.lazy";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    locale: "en",
    timezone: "UTC",
  }),
}));

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 300 }}>{children}</div>
    ),
  };
});

vi.mock("@/lib/format", () => ({
  fmtPrice: (val: number) => val.toFixed(2),
  fmtPct: (val: number) => `${val.toFixed(2)}%`,
  fmtUsd: (val: number) => `$${val.toFixed(2)}`,
}));

vi.mock("@/lib/analytics/exitAnalysis", () => ({
  computeExitAnalysis: vi.fn().mockReturnValue({
    mfePct: 5.5,
    maePct: -2.3,
    capturedPct: 70,
    bestPrice: 51500,
  }),
  candlesLookReal: vi.fn().mockReturnValue(false),
}));

global.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ candles: [], fills: [] }),
  }),
) as any;

const mockTrade = {
  id: "trade-123",
  symbol: "BTCUSDT",
  market: "futures",
  exchange: "bybit",
  side: "long" as const,
  entryPrice: 50000,
  exitPrice: 51000,
  netPnl: 100,
  quantity: 0.1,
  fees: 5,
  entryTime: Date.now() - 3600000,
  exitTime: Date.now(),
  accountId: "acc-1",
  stopLoss: 49000,
};

describe("charts.lazy", () => {
  it("EquityChart shows loading skeleton then resolves to real chart", async () => {
    const { container } = render(<EquityChart data={[{ t: 1, equity: 1, pnl: 0 }]} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).not.toContain("dash.noData");
  });

  it("DailyPnlChart eventually renders without noData for real data", async () => {
    render(
      <DailyPnlChart
        data={[{ date: "2024-01-01", pnl: 10, cumulative: 10, winRate: 100, winR: 1, lossR: 0, trades: 1 }]}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("dash.noData")).not.toBeInTheDocument();
  });

  it("BreakdownChart renders empty state eventually", async () => {
    render(<BreakdownChart data={[]} />);
    await screen.findByText("dash.noData");
  });

  it("DrawdownChart renders empty state eventually", async () => {
    render(<DrawdownChart data={[]} />);
    await screen.findByText("dash.noData");
  });

  it("Histogram renders empty state eventually", async () => {
    render(<Histogram data={[]} />);
    await screen.findByText("dash.noData");
  });

  it("PnlHeatmap renders empty state eventually", async () => {
    render(<PnlHeatmap daily={[]} />);
    await screen.findByText("dash.noData");
  });

  it("RHeatmap renders empty state eventually", async () => {
    render(<RHeatmap daily={[]} />);
    await screen.findByText("dash.noData");
  });

  it("TradeChart renders without throwing", async () => {
    expect(() => render(<TradeChart trade={mockTrade as any} />)).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
  });
});
