import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { prisma } from "@/lib/db";
import { getFeedFreshness, ONLINE_THRESHOLD_MS } from "@/lib/admin";
import AdminOverviewPage from "../page";

vi.mock("@/lib/i18n/server", () => ({
  getServerT: async () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    locale: "ru",
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { count: vi.fn() },
    exchangeAccount: { count: vi.fn() },
    fill: { count: vi.fn() },
  },
}));

vi.mock("@/lib/admin", () => ({
  ONLINE_THRESHOLD_MS: 10 * 60_000,
  getFeedFreshness: vi.fn(),
}));

describe("AdminOverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.user.count as any).mockResolvedValue(5);
    (prisma.exchangeAccount.count as any).mockResolvedValue(3);
    (prisma.fill.count as any).mockResolvedValue(1000);
  });

  it("renders stats and healthy feeds banner when no feeds are stale", async () => {
    (getFeedFreshness as any).mockResolvedValue([
      { symbol: "BTCUSDT", exchange: "binance", stale: false, lagMs: 1000 },
    ]);

    const ui = await AdminOverviewPage();
    render(ui as React.ReactElement);

    expect(screen.getByText("admin.overview.title")).toBeInTheDocument();
    expect(screen.getByText(/admin.overview.feedsHealthy/)).toBeInTheDocument();
    expect(screen.getAllByText("5").length).toBeGreaterThan(0);
  });

  it("renders stale feeds alert with details when feeds are down", async () => {
    (getFeedFreshness as any).mockResolvedValue([
      { symbol: "BTCUSDT", exchange: "binance", stale: true, lagMs: Infinity },
    ]);

    const ui = await AdminOverviewPage();
    render(ui as React.ReactElement);

    expect(screen.getByText(/admin.overview.feedsDown/)).toBeInTheDocument();
    expect(screen.getByText(/BTCUSDT·binance/)).toBeInTheDocument();
  });

  it("renders sync error banner when there are sync errors", async () => {
    (prisma.exchangeAccount.count as any)
      .mockResolvedValueOnce(3) // accounts total
      .mockResolvedValueOnce(2); // syncErrors
    (getFeedFreshness as any).mockResolvedValue([]);

    const ui = await AdminOverviewPage();
    render(ui as React.ReactElement);

    expect(screen.getByText(/admin.overview.syncErrorBanner/)).toBeInTheDocument();
  });
});
