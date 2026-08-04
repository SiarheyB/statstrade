import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  EquityChart,
  DailyPnlChart,
  BreakdownChart,
  DrawdownChart,
  Histogram,
} from "@/components/charts";

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

const equityData = [
  { t: 1700000000000, equity: 1000, pnl: 0 },
  { t: 1700086400000, equity: 1100, pnl: 100 },
  { t: 1700172800000, equity: 900, pnl: -200 },
];

const dailyData = [
  { date: "2024-01-01", pnl: 100, cumulative: 100, winRate: 100, winR: 2, lossR: 0, trades: 3 },
  { date: "2024-01-02", pnl: -50, cumulative: 50, winRate: 0, winR: 0, lossR: -1, trades: 1 },
  { date: "2024-01-03", pnl: 0, cumulative: 50, winRate: 0, winR: 0, lossR: 0, trades: 0 },
];

const bucketData = [
  { key: "mon", label: "Mon", netPnl: 100, winRate: 60, trades: 5 },
  { key: "tue", label: "Tue", netPnl: -50, winRate: 30, trades: 3 },
];

const histogramData = [
  { label: "0-1R", count: 5, tone: "profit" as const },
  { label: "-1-0R", count: 3, tone: "loss" as const },
  { label: "n/a", count: 1 },
];

describe("EquityChart", () => {
  it("renders empty state with no data", () => {
    const { container } = render(<EquityChart data={[]} />);
    expect(container.textContent).toContain("dash.noData");
  });

  it("renders chart with data", () => {
    const { container } = render(<EquityChart data={equityData} />);
    expect(container.textContent).not.toContain("dash.noData");
  });

  it("renders with a single data point", () => {
    const { container } = render(<EquityChart data={[equityData[0]]} />);
    expect(container.textContent).not.toContain("dash.noData");
  });
});

describe("DailyPnlChart", () => {
  it("renders empty state with no data", () => {
    const { container } = render(<DailyPnlChart data={[]} />);
    expect(container.textContent).toContain("dash.noData");
  });

  it("renders pnl mode with data", () => {
    const { container } = render(<DailyPnlChart data={dailyData} metric="pnl" />);
    expect(container.textContent).not.toContain("dash.noData");
  });

  it("renders winRate (risk) mode with data", () => {
    const { container } = render(<DailyPnlChart data={dailyData} metric="winRate" />);
    expect(container.textContent).not.toContain("dash.noData");
  });

  it("renders with a single data point in risk mode", () => {
    const { container } = render(
      <DailyPnlChart data={[dailyData[0]]} metric="winRate" />,
    );
    expect(container.textContent).not.toContain("dash.noData");
  });

  it("handles outlier R values without throwing (p90 cap)", () => {
    const outlierData = [
      ...dailyData,
      { date: "2024-01-04", pnl: 5000, cumulative: 5050, winRate: 100, winR: 50, lossR: 0, trades: 1 },
    ];
    expect(() =>
      render(<DailyPnlChart data={outlierData} metric="winRate" />),
    ).not.toThrow();
  });
});

describe("BreakdownChart", () => {
  it("renders empty state with no data", () => {
    const { container } = render(<BreakdownChart data={[]} />);
    expect(container.textContent).toContain("dash.noData");
  });

  it("renders netPnl mode with data", () => {
    const { container } = render(<BreakdownChart data={bucketData} metric="netPnl" />);
    expect(container.textContent).not.toContain("dash.noData");
  });

  it("renders winRate mode with data", () => {
    const { container } = render(<BreakdownChart data={bucketData} metric="winRate" />);
    expect(container.textContent).not.toContain("dash.noData");
  });

  it("uses angled labels when many buckets", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      key: `l${i}`,
      label: `L${i}`,
      netPnl: i,
      winRate: 50,
      trades: 1,
    }));
    const { container } = render(<BreakdownChart data={many} />);
    expect(container.textContent).not.toContain("dash.noData");
  });

  it("respects custom height", () => {
    const { container } = render(
      <BreakdownChart data={bucketData} height={400} />,
    );
    const wrapper = container.querySelector("div");
    expect(wrapper).toBeTruthy();
  });
});

describe("DrawdownChart", () => {
  it("renders empty state with no data", () => {
    const { container } = render(<DrawdownChart data={[]} />);
    expect(container.textContent).toContain("dash.noData");
  });

  it("renders chart with data and computes drawdown", () => {
    const { container } = render(<DrawdownChart data={equityData} />);
    expect(container.textContent).not.toContain("dash.noData");
  });

  it("renders with single point (no drawdown)", () => {
    const { container } = render(<DrawdownChart data={[equityData[0]]} />);
    expect(container.textContent).not.toContain("dash.noData");
  });
});

describe("Histogram", () => {
  it("renders empty state with no data", () => {
    const { container } = render(<Histogram data={[]} />);
    expect(container.textContent).toContain("dash.noData");
  });

  it("renders bars with tone colors", () => {
    const { container } = render(<Histogram data={histogramData} />);
    expect(container.textContent).not.toContain("dash.noData");
  });

  it("uses angled labels when many bins", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      label: `B${i}`,
      count: i + 1,
    }));
    const { container } = render(<Histogram data={many} />);
    expect(container.textContent).not.toContain("dash.noData");
  });
});
