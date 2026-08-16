import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getEnabledExchangeMetas } from "@/lib/exchangeToggle";
import Home from "../page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/exchangeToggle", () => ({
  getEnabledExchangeMetas: vi.fn(),
}));

// @/lib/exchanges pulls in ccxt (used elsewhere for live exchange clients) —
// only the static SUPPORTED_EXCHANGES list is needed here.
vi.mock("@/lib/exchanges", () => ({
  SUPPORTED_EXCHANGES: [
    { id: "binance", name: "Binance" },
    { id: "bybit", name: "Bybit" },
    { id: "okx", name: "OKX" },
  ],
}));

vi.mock("@/lib/i18n/server", () => ({
  getServerT: async () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    locale: "ru",
  }),
  getLocale: async () => "ru",
  getTimezone: async () => "auto",
}));

// Рыночный блок (календарь + сигнал дня + новости) ходит в БД и фиды — здесь
// проверяется каркас лендинга, поэтому данные подменяем пустым срезом.
vi.mock("@/lib/landing", () => ({
  // CALENDAR_DAYS читает LandingCalendar — без него мок падает на импорте.
  CALENDAR_DAYS: 3,
  getLandingData: vi.fn(async () => ({
    generatedAt: Date.parse("2026-08-16T12:00:00Z"),
    stats: { setups: 9, symbols: 689, events: 5, news: 4 },
    events: [],
    signal: null,
    news: [],
  })),
}));

vi.mock("@/components/LocaleMenu", () => ({
  default: () => <div data-testid="locale-menu" />,
}));

describe("Home (landing page)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /dashboard when a session exists", async () => {
    (getSession as any).mockResolvedValue({ email: "user@example.com" });

    await expect(Home()).rejects.toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("renders the landing page with exchange badge and features when there is no session", async () => {
    (getSession as any).mockResolvedValue(null);
    (getEnabledExchangeMetas as any).mockResolvedValue([
      { name: "Binance" },
      { name: "Bybit" },
      { name: "OKX" },
    ]);

    const ui = await Home();
    render(ui as React.ReactElement);

    expect(screen.getByText("TradeStats")).toBeInTheDocument();
    expect(screen.getByTestId("locale-menu")).toBeInTheDocument();
    expect(screen.getByText("landing.signIn")).toBeInTheDocument();
    expect(screen.getByText("landing.start")).toBeInTheDocument();
    // Блок «как это работает»: три колонки по циклу работы трейдера вместо
    // прежней сетки из девяти одинаковых плиток.
    expect(screen.getByText("features.title")).toBeInTheDocument();
    expect(screen.getByText("features.before.title")).toBeInTheDocument();
    expect(screen.getByText("features.after.title")).toBeInTheDocument();
    expect(screen.getByText("features.always.title")).toBeInTheDocument();
    // Биржи перечислены строкой подключения, а не карточкой-фичей.
    expect(screen.getByText("Binance")).toBeInTheDocument();
  });

  it("falls back to the static exchange list when getEnabledExchangeMetas rejects", async () => {
    (getSession as any).mockResolvedValue(null);
    (getEnabledExchangeMetas as any).mockRejectedValue(new Error("db down"));

    const ui = await Home();
    render(ui as React.ReactElement);

    // Should still render fine using the static SUPPORTED_EXCHANGES fallback.
    expect(screen.getByText("TradeStats")).toBeInTheDocument();
  });
});
