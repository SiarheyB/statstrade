import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
vi.mock("@/lib/i18n/server", () => ({
  getServerT: async () => ({
    t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}:${JSON.stringify(vars)}` : k),
    locale: "ru",
  }),
}));
vi.mock("@/components/LocaleMenu", () => ({ default: () => <div data-testid="locale-menu" /> }));
vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}:${JSON.stringify(vars)}` : k),
    locale: "ru",
    timezone: "auto",
  }),
}));
vi.mock("@/lib/mentorShare", () => ({
  computePublicSummary: vi.fn(),
  computePublicTrades: vi.fn(),
  PUBLIC_TRADES_LIMIT: 500,
}));

import { prisma } from "@/lib/db";
import { getFeatureConfig } from "@/lib/featureConfig";
import { computePublicSummary, computePublicTrades } from "@/lib/mentorShare";
import SharePage from "../page";

const mockedFindUnique = prisma.shareLink.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedGetFeatureConfig = getFeatureConfig as unknown as ReturnType<typeof vi.fn>;
const mockedComputePublicSummary = computePublicSummary as unknown as ReturnType<typeof vi.fn>;
const mockedComputePublicTrades = computePublicTrades as unknown as ReturnType<typeof vi.fn>;

const TRADE = {
  id: "t1",
  symbol: "BTC/USDT",
  side: "long",
  market: "spot",
  entryTime: "2026-06-01T10:00:00.000Z",
  exitTime: "2026-06-01T12:30:00.000Z",
  durationMs: 9_000_000,
  entryPrice: 60000,
  exitPrice: 61200,
  returnPct: 0.02,
  rr: 2.4,
  result: "win" as const,
  imageUrl: "https://drive.example/file/abc",
  stopLoss: 59500,
  entryPoint: "Ретест",
  entryType: "Консервативный",
  pattern: "Ложный пробой",
  mistake: "Ранний вход",
  note: "Вошёл раньше подтверждения",
};

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.shareLink.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
  mockedComputePublicTrades.mockResolvedValue([]);
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
    expect(screen.getByText("mentorPage.unavailable")).toBeInTheDocument();
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  it("renders Unavailable when share link does not exist", async () => {
    mockedGetFeatureConfig.mockResolvedValue({ enabled: true });
    mockedFindUnique.mockResolvedValue(null);
    await renderSharePage();
    expect(screen.getByText("mentorPage.unavailable")).toBeInTheDocument();
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
    expect(screen.getByText("mentorPage.unavailable")).toBeInTheDocument();
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
      firstTradeAt: "2026-01-01T00:00:00.000Z",
      lastTradeAt: "2026-06-01T00:00:00.000Z",
      netPnl: 1234.56,
      winRate: 55,
      profitFactor: 1.8,
      maxDrawdownPct: 12,
      equityCurve: [
        { t: 1, v: 0 },
        { t: 2, v: 100 },
      ],
    });

    await renderSharePage();

    expect(screen.getByText("My Trading Stats")).toBeInTheDocument();
    expect(screen.getByText(/mentorPage\.subtitle/)).toBeInTheDocument();
    expect(screen.getByText("mentorPage.winRate")).toBeInTheDocument();
    // Просадка — это потеря: со знаком минус, а не «+9.5%». Доля прибыльных —
    // вообще без знака.
    expect(screen.getByText("−12.0%")).toBeInTheDocument();
    expect(screen.getByText("55%")).toBeInTheDocument();
    // Денег на странице нет — ни суммы, ни кривой эквити (она в долларах).
    expect(document.body.textContent).not.toMatch(/1234|1,234|\$/);
    expect(prisma.shareLink.update).toHaveBeenCalledWith({
      where: { id: "link1" },
      data: { lastViewedAt: expect.any(Date) },
    });
  });

  it("показывает сделки по счетам: структура и скриншот есть, суммы нет", async () => {
    mockedGetFeatureConfig.mockResolvedValue({ enabled: true });
    mockedFindUnique.mockResolvedValue({
      id: "link1", userId: "u1", token: "tok123", revokedAt: null, label: "Stats",
    });
    mockedComputePublicSummary.mockResolvedValue({
      totalTrades: 1, firstTradeAt: null, lastTradeAt: null, netPnl: 1234.56,
      winRate: 1, profitFactor: 3, maxDrawdownPct: 0, equityCurve: [],
    });
    mockedComputePublicTrades.mockResolvedValue([
      { accountId: "a1", label: "Основной", exchange: "bybit", trades: [TRADE] },
      { accountId: "a2", label: "Форекс", exchange: "mt5", trades: [{ ...TRADE, id: "t2", imageUrl: null }] },
    ]);

    await renderSharePage();

    // Каждая биржа — своей таблицей.
    expect(screen.getByText("Основной")).toBeInTheDocument();
    expect(screen.getByText("Форекс")).toBeInTheDocument();
    expect(screen.getAllByText("BTCUSDT")).toHaveLength(2); // fmtSymbol убирает слеш
    expect(screen.getAllByText("+2.40R")).toHaveLength(2); // R остаётся

    // Скриншот — кнопкой прямо в строке: открывает просмотрщик, а не вкладку.
    expect(screen.getByRole("button", { name: /mentorPage\.open/ })).toBeInTheDocument();

    // Комментарий — в разборе, он раскрывается по клику.
    expect(screen.queryByText("Вошёл раньше подтверждения")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText("BTCUSDT")[0]);
    expect(screen.getByText("Вошёл раньше подтверждения")).toBeInTheDocument();

    // Ни одной денежной величины в разметке.
    expect(document.body.textContent).not.toMatch(/1234|1,234|\$/);
    // Разбор виден в строке: паттерн и ТВХ — чипами.
    expect(screen.getAllByText("Ложный пробой").length).toBeGreaterThan(0);
  });

  it("falls back to the default title when the link has no label", async () => {
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

    expect(screen.getByText("mentorPage.defaultTitle")).toBeInTheDocument();
  });
});
