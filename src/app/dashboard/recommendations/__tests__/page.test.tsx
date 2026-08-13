import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecommendationsPage from "../page";
import { setFormatLocale, setFormatTimezone } from "@/lib/format";

vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => ({}) }));

const DAY = 86_400_000;
const D = (n: number) => Date.UTC(2026, 7, n);

const QUALITY = {
  crossings: 0,
  falseBreakouts: 0,
  deepestFalseBreakoutAtr: 0,
  contamination: 0.02,
  runwayAtr: 3,
  closeDistanceAtr: 0.1,
};

const SETUPS = [
  {
    id: "1",
    symbol: "BTCUSDT",
    levelPrice: 120,
    levelType: "break_point",
    strength: 3,
    distanceAtr: 0.4,
    bias: "breakout",
    direction: "long",
    signals: { for: ["close_near_level"], against: [] },
    quality: QUALITY,
    atr: 4,
    currentPrice: 118,
    bsuAt: new Date(D(5)).toISOString(),
    candlesTo: new Date(D(12)).toISOString(),
  },
  {
    id: "2",
    symbol: "ETHUSDT",
    levelPrice: 80,
    levelType: "mirror",
    strength: 2,
    distanceAtr: 0.9,
    bias: "false_breakout",
    direction: "long",
    signals: { for: [], against: ["big_bars_approach"] },
    quality: QUALITY,
    atr: 2,
    currentPrice: 84,
    bsuAt: new Date(D(3)).toISOString(),
    candlesTo: new Date(D(12)).toISOString(),
  },
];

// Свечи 01.08–13.08; последняя (13.08) новее candlesTo — это сегодняшний
// незакрытый бар, он в анализе не участвовал.
const CANDLES = Array.from({ length: 13 }, (_, i) => ({
  t: D(1) + i * DAY,
  o: 100,
  h: 102,
  l: 98,
  c: 100,
}));

function mockFetch() {
  return vi.fn(async (url: string) => {
    if (typeof url === "string" && url.startsWith("/api/features")) {
      return { ok: true, json: async () => ({ value: { enabled: true } }) } as unknown as Response;
    }
    if (typeof url === "string" && url.includes("/candles")) {
      return { ok: true, json: async () => ({ candles: CANDLES }) } as unknown as Response;
    }
    return { ok: true, json: async () => ({ setups: SETUPS }) } as unknown as Response;
  });
}

describe("RecommendationsPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the trade side next to each setup type", async () => {
    render(<RecommendationsPage />);
    expect(await screen.findByText(/Пробой · лонг/)).toBeInTheDocument();
    // Уровень ниже цены → ложный пробой отрабатывается вверх.
    expect(screen.getByText(/Ложный пробой · лонг/)).toBeInTheDocument();
  });

  it("offers no neutral filter", async () => {
    render(<RecommendationsPage />);
    await screen.findByText(/Пробой · лонг/);
    expect(screen.queryByRole("button", { name: "Нейтрально" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Лонг" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Шорт" })).toBeInTheDocument();
  });

  it("filters by trade side", async () => {
    render(<RecommendationsPage />);
    await screen.findByText(/Пробой · лонг/);

    await userEvent.click(screen.getByRole("button", { name: "Шорт" }));
    expect(screen.queryByText("BTCUSDT")).not.toBeInTheDocument();
    expect(screen.queryByText("ETHUSDT")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Лонг" }));
    expect(screen.getByText("BTCUSDT")).toBeInTheDocument();
    expect(screen.getByText("ETHUSDT")).toBeInTheDocument();
  });
});

describe("expanded setup card", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
    setFormatLocale("ru");
    setFormatTimezone("UTC");
  });

  afterEach(() => vi.unstubAllGlobals());

  async function openFirstCard() {
    render(<RecommendationsPage />);
    await screen.findByText(/Пробой · лонг/);
    await userEvent.click(screen.getByText("BTCUSDT"));
  }

  it("labels the bar that formed the level (БСУ) with its date", async () => {
    await openFirstCard();
    expect(await screen.findByText("БСУ — 05.08.2026")).toBeInTheDocument();
  });

  it("says which day the analysis was based on", async () => {
    await openFirstCard();
    expect(await screen.findByText(/анализ по закрытию 12\.08\.2026/)).toBeInTheDocument();
  });

  it("marks the БСУ bar on the chart and dims the still-forming one", async () => {
    await openFirstCard();
    const chart = await screen.findByRole("img", { name: /Дневной график/ });

    // Стрелка с подписью БСУ — напротив бара, сформировавшего уровень.
    expect(chart.textContent).toContain("БСУ");
    // Сегодняшний бар (13.08 — новее candlesTo) приглушён, остальные нет.
    expect(chart.querySelectorAll('g[opacity="0.45"]')).toHaveLength(1);
  });
});
