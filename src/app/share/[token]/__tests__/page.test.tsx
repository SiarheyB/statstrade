import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/db", () => ({
  prisma: {
    shareLink: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));
vi.mock("@/lib/featureConfig", () => ({
  getFeatureConfig: vi.fn(),
}));
vi.mock("@/lib/mentorShare", () => ({
  computePublicSummary: vi.fn(),
}));
vi.mock("@/components/charts.lazy", () => ({
  EquityChart: () => <div data-testid="equity-chart" />,
}));

import { prisma } from "@/lib/db";
import { getFeatureConfig } from "@/lib/featureConfig";
import { computePublicSummary } from "@/lib/mentorShare";
import SharePage from "../page";

const mockedFindUnique = prisma.shareLink.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedGetFeatureConfig = getFeatureConfig as unknown as ReturnType<typeof vi.fn>;
const mockedComputePublicSummary = computePublicSummary as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.shareLink.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

// SharePage is an async server component (params is a Promise). RTL can't
// render an async component directly, so we await the component function
// ourselves and render the resolved JSX tree.
async function renderSharePage(token = "tok123") {
  const element = await SharePage({ params: Promise.resolve({ token }) });
  return render(element as React.ReactElement);
}

describe("SharePage (share/[token])", () => {
  it("renders Unavailable when mentorMode feature is disabled", async () => {
    mockedGetFeatureConfig.mockResolvedValue({ enabled: false });
    await renderSharePage();
    expect(screen.getByText(/isn't available/)).toBeInTheDocument();
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  it("renders Unavailable when share link does not exist", async () => {
    mockedGetFeatureConfig.mockResolvedValue({ enabled: true });
    mockedFindUnique.mockResolvedValue(null);
    await renderSharePage();
    expect(screen.getByText(/isn't available/)).toBeInTheDocument();
  });

  it("renders Unavailable when share link is revoked", async () => {
    mockedGetFeatureConfig.mockResolvedValue({ enabled: true });
    mockedFindUnique.mockResolvedValue({
      id: "link1",
      userId: "u1",
      token: "tok123",
      revokedAt: new Date(),
      label: null,
    });
    await renderSharePage();
    expect(screen.getByText(/isn't available/)).toBeInTheDocument();
  });

  it("renders the public summary when link is valid", async () => {
    mockedGetFeatureConfig.mockResolvedValue({ enabled: true });
    mockedFindUnique.mockResolvedValue({
      id: "link1",
      userId: "u1",
      token: "tok123",
      revokedAt: null,
      label: "My Trading Stats",
    });
    mockedComputePublicSummary.mockResolvedValue({
      totalTrades: 42,
      firstTradeAt: new Date("2026-01-01"),
      lastTradeAt: new Date("2026-06-01"),
      netPnl: 1234.56,
      winRate: 0.55,
      profitFactor: 1.8,
      maxDrawdownPct: 0.12,
      equityCurve: [
        { t: 1, v: 0 },
        { t: 2, v: 100 },
      ],
    });

    await renderSharePage();

    expect(screen.getByText("My Trading Stats")).toBeInTheDocument();
    expect(screen.getByText(/42 trades/)).toBeInTheDocument();
    expect(screen.getByText("Net P&L")).toBeInTheDocument();
    expect(screen.getByText("Win rate")).toBeInTheDocument();
    expect(screen.getByTestId("equity-chart")).toBeInTheDocument();
    expect(prisma.shareLink.update).toHaveBeenCalledWith({
      where: { id: "link1" },
      data: { lastViewedAt: expect.any(Date) },
    });
  });

  it("falls back to default title and hides equity chart when curve too short", async () => {
    mockedGetFeatureConfig.mockResolvedValue({ enabled: true });
    mockedFindUnique.mockResolvedValue({
      id: "link2",
      userId: "u2",
      token: "tok456",
      revokedAt: null,
      label: null,
    });
    mockedComputePublicSummary.mockResolvedValue({
      totalTrades: 0,
      firstTradeAt: null,
      lastTradeAt: null,
      netPnl: -50,
      winRate: 0,
      profitFactor: 0,
      maxDrawdownPct: 0,
      equityCurve: [],
    });

    await renderSharePage("tok456");

    expect(screen.getByText("Trading performance")).toBeInTheDocument();
    expect(screen.queryByTestId("equity-chart")).not.toBeInTheDocument();
  });
});
