import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import CalendarPage from "../page";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    locale: "ru",
    timezone: "UTC+3",
    setLocale: vi.fn(),
    setTimezone: vi.fn(),
  }),
}));

type Call = { url: string };
const calls: Call[] = [];

function mockFetch(days: unknown[], latest: string | null, trades: unknown[] = []) {
  global.fetch = vi.fn((url: string) => {
    calls.push({ url });
    if (url.startsWith("/api/calendar")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          days,
          accounts: [{ id: "acc-1", label: "Main", exchange: "bybit" }],
          latest,
        }),
      });
    }
    if (url.startsWith("/api/trades")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ trades, total: trades.length }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  }) as never;
}

function day(date: string, over: Record<string, unknown> = {}) {
  return { date, netPnl: 0, trades: 0, wins: 0, losses: 0, winR: 0, lossR: 0, rTrades: 0, ...over };
}

const urlsFor = (prefix: string) => calls.filter((c) => c.url.startsWith(prefix)).map((c) => c.url);

describe("CalendarPage", () => {
  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
  });

  it("запрашивает агрегаты сеткой, а не всю историю сделок", async () => {
    mockFetch([], null);
    render(<CalendarPage />);

    await waitFor(() => expect(urlsFor("/api/calendar").length).toBeGreaterThan(0));
    const url = urlsFor("/api/calendar")[0];
    const params = new URLSearchParams(url.split("?")[1]);

    // Диапазон — ровно 42 дня сетки, не «вся история».
    const from = new Date(params.get("from")!).getTime();
    const to = new Date(params.get("to")!).getTime();
    expect((to - from) / 86_400_000).toBe(42);
    // Таймзона пользователя уезжает на сервер: сутки нарезает он.
    expect(params.get("tzOffset")).toBe("180");
    // Старый источник данных больше не используется.
    expect(urlsFor("/api/stats")).toHaveLength(0);
  });

  it("рисует дневные суммы из ответа сервера", async () => {
    mockFetch(
      [day("2026-03-10", { netPnl: 250, trades: 4, wins: 3, winR: 2.5, rTrades: 4 })],
      "2026-03-10",
    );
    render(<CalendarPage />);

    await waitFor(() => expect(screen.getByText("4 · 75%")).toBeInTheDocument());
    // Месячная сводка складывается из тех же дней.
    expect(screen.getAllByText(/250/).length).toBeGreaterThan(0);
    expect(screen.getByText("+2.5R")).toBeInTheDocument();
  });

  it("на первом открытии прыгает в месяц последней сделки", async () => {
    mockFetch([], "2025-11-20");
    render(<CalendarPage />);

    await waitFor(() => expect(urlsFor("/api/calendar").length).toBeGreaterThan(1));
    // Второй запрос — уже за ноябрь 2025, а не за текущий месяц.
    const second = new URLSearchParams(urlsFor("/api/calendar")[1].split("?")[1]);
    const from = new Date(second.get("from")!);
    expect(from.getTime()).toBeLessThan(new Date("2025-12-01T00:00:00Z").getTime());
  });

  it("по клику на день грузит сделки этого дня окном локальных суток", async () => {
    mockFetch(
      [day("2026-03-10", { netPnl: 100, trades: 1, wins: 1 })],
      "2026-03-10",
      [{
        id: "t1", symbol: "BTCUSDT", side: "long", netPnl: 100,
        exitTime: "2026-03-10T09:00:00Z",
      }],
    );
    render(<CalendarPage />);
    await waitFor(() => expect(screen.getByText("1 · 100%")).toBeInTheDocument());

    fireEvent.click(screen.getByText("1 · 100%"));

    await waitFor(() => expect(urlsFor("/api/trades").length).toBeGreaterThan(0));
    const params = new URLSearchParams(urlsFor("/api/trades")[0].split("?")[1]);
    const from = new Date(params.get("from")!);
    const to = new Date(params.get("to")!);
    // UTC+3: локальные сутки 10 марта начинаются в 21:00Z девятого.
    expect(from.toISOString()).toBe("2026-03-09T21:00:00.000Z");
    expect((to.getTime() - from.getTime()) / 3_600_000).toBe(24);
    await waitFor(() => expect(screen.getByText("BTCUSDT")).toBeInTheDocument());
  });
});
