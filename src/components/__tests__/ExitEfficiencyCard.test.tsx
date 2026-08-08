import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ExitEfficiencyCard } from "@/components/ExitEfficiencyCard";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/format", () => ({
  fmtPct: (val: number) => `${val.toFixed(2)}%`,
  fmtUsd: (val: number) => `$${val}`,
  fmtSymbol: (val: string) => val,
}));
vi.mock("@/lib/analytics/scopeLabel", () => ({ scopeLabel: () => "All trades" }));
vi.mock("@/lib/analytics/exitEfficiency", () => ({ pickRecentTrades: () => [] }));

const trade = { id: "t1", exchange: "binance", exitTime: "2026-03-01T00:00:00Z" } as never;

const summary = {
  analyzed: 12,
  skipped: 3,
  pending: 0,
  avgMfePct: 4.5,
  avgMaePct: 1.25,
  avgCapturedPct: 62,
  leftOnTableUsd: 987,
  worst: [{ id: "w1", symbol: "BTCUSDT", capturedPct: -10 }],
};

const urls: string[] = [];
function mockFetch(feature: unknown, summaryBody: unknown) {
  global.fetch = vi.fn((url: string) => {
    urls.push(url);
    if (url.startsWith("/api/features")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: feature }) });
    }
    if (url.startsWith("/api/exit-efficiency")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(summaryBody) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  }) as never;
}

describe("ExitEfficiencyCard", () => {
  beforeEach(() => {
    urls.length = 0;
    vi.clearAllMocks();
  });

  it("ничего не рендерит, когда фича выключена админом", async () => {
    mockFetch({ enabled: false, maxTrades: 60, concurrency: 3 }, summary);
    const { container } = render(<ExitEfficiencyCard trades={[trade]} accounts={[]} />);
    await waitFor(() => expect(urls.some((u) => u.startsWith("/api/features"))).toBe(true));
    expect(container.textContent).toBe("");
    // Сводку не запрашиваем вовсе.
    expect(urls.some((u) => u.startsWith("/api/exit-efficiency"))).toBe(false);
  });

  it("берёт готовую сводку с сервера и не считает MFE в браузере", async () => {
    mockFetch({ enabled: true, maxTrades: 60, concurrency: 3 }, summary);
    render(<ExitEfficiencyCard trades={[trade]} accounts={[]} />);

    await waitFor(() => expect(screen.getByText("4.50%")).toBeInTheDocument());
    expect(screen.getByText("1.25%")).toBeInTheDocument();
    expect(screen.getByText("$987")).toBeInTheDocument();
    expect(screen.getByText("BTCUSDT")).toBeInTheDocument();

    // Ни одного запроса к свечам — весь расчёт остался на сервере.
    expect(urls.some((u) => u.startsWith("/api/trade-chart"))).toBe(false);
  });

  it("сообщает, что часть сделок ещё считается в фоне", async () => {
    mockFetch({ enabled: true, maxTrades: 60, concurrency: 3 }, { ...summary, pending: 7 });
    render(<ExitEfficiencyCard trades={[trade]} accounts={[]} />);
    await waitFor(() => expect(screen.getByText("an.exitEfficiencyPending")).toBeInTheDocument());
  });

  it("кнопка перечитывает сводку", async () => {
    mockFetch({ enabled: true, maxTrades: 60, concurrency: 3 }, summary);
    render(<ExitEfficiencyCard trades={[trade]} accounts={[]} />);
    await waitFor(() => expect(screen.getByText("4.50%")).toBeInTheDocument());

    const before = urls.filter((u) => u.startsWith("/api/exit-efficiency")).length;
    fireEvent.click(screen.getByText("an.exitEfficiencyRun"));
    await waitFor(() =>
      expect(urls.filter((u) => u.startsWith("/api/exit-efficiency")).length).toBe(before + 1),
    );
  });
});
