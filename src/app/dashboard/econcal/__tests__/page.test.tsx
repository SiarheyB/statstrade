import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EconCalPage from "../page";

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

const today = new Date();
const tomorrow = new Date(today.getTime() + 86_400_000);

const events = [
  {
    id: "1",
    time: today.toISOString(),
    currency: "USD",
    country: "United States",
    title: "Core CPI m/m",
    impact: "high",
    category: "Inflation",
    forecast: "0.3%",
    previous: "0.2%",
    actual: null,
  },
  {
    id: "2",
    time: tomorrow.toISOString(),
    currency: "EUR",
    country: "Euro Area",
    title: "German WPI m/m",
    impact: "low",
    category: "Inflation",
    forecast: null,
    previous: null,
    actual: null,
  },
];

function mockFetch(payload = { events, currencies: ["USD", "EUR"], categories: ["Inflation"] }) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) });
}

describe("EconCalPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch();
  });

  it("renders today's events with the title translated into Russian", async () => {
    render(<EconCalPage />);
    expect(await screen.findByText("Базовый ИПЦ (м/м)")).toBeInTheDocument();
    // Оригинал остаётся доступен по наведению — по нему событие ищут в других
    // источниках.
    expect(screen.getByTitle("Core CPI m/m")).toBeInTheDocument();
  });

  it("shows an explanation icon only for indicators that have one", async () => {
    render(<EconCalPage />);
    await screen.findByText("Базовый ИПЦ (м/м)");
    // У Core CPI пояснение есть, у WPI — нет.
    expect(screen.getByTitle(/еды и топлива/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("econcal.thisWeek", { selector: "button" }));
    await screen.findByText("Индекс оптовых цен (Германия, м/м)");
    expect(screen.queryAllByTitle(/еды и топлива/)).toHaveLength(1);
  });

  it("switches the day scope between today, tomorrow and the whole week", async () => {
    render(<EconCalPage />);
    await screen.findByText("Базовый ИПЦ (м/м)");

    fireEvent.click(screen.getByText("econcal.tomorrow"));
    await waitFor(() =>
      expect(screen.queryByText("Базовый ИПЦ (м/м)")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Индекс оптовых цен (Германия, м/м)")).toBeInTheDocument();

    fireEvent.click(screen.getByText("econcal.thisWeek", { selector: "button" }));
    await waitFor(() => expect(screen.getByText("Базовый ИПЦ (м/м)")).toBeInTheDocument());
  });

  it("filters by currency", async () => {
    render(<EconCalPage />);
    fireEvent.click(screen.getByText("econcal.thisWeek", { selector: "button" }));
    await screen.findByText("Базовый ИПЦ (м/м)");

    // Валюта встречается и в строке события — берём именно кнопку-фильтр.
    fireEvent.click(screen.getByRole("button", { name: /EUR/ }));
    await waitFor(() =>
      expect(screen.queryByText("Базовый ИПЦ (м/м)")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Индекс оптовых цен (Германия, м/м)")).toBeInTheDocument();
  });

  it("filters by impact", async () => {
    render(<EconCalPage />);
    fireEvent.click(screen.getByText("econcal.thisWeek", { selector: "button" }));
    await screen.findByText("Индекс оптовых цен (Германия, м/м)");

    fireEvent.click(screen.getByText("econcal.impact.high"));
    await waitFor(() =>
      expect(screen.queryByText("Индекс оптовых цен (Германия, м/м)")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Базовый ИПЦ (м/м)")).toBeInTheDocument();
  });

  it("localizes category names in the filter dropdown", async () => {
    render(<EconCalPage />);
    await screen.findByText("Базовый ИПЦ (м/м)");
    expect(screen.getByRole("option", { name: "Инфляция" })).toBeInTheDocument();
  });

  it("requests a manual refresh with refresh=1", async () => {
    render(<EconCalPage />);
    await screen.findByText("Базовый ИПЦ (м/м)");
    fireEvent.click(screen.getByText("econcal.refresh"));
    await waitFor(() => {
      const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("refresh=1"))).toBe(true);
    });
  });

  it("shows the empty state when nothing matches", async () => {
    mockFetch({ events: [], currencies: [], categories: [] });
    render(<EconCalPage />);
    expect(await screen.findByText("econcal.empty")).toBeInTheDocument();
  });

  it("survives a failed request without crashing", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
    render(<EconCalPage />);
    expect(await screen.findByText("econcal.empty")).toBeInTheDocument();
  });
});

describe("EconCalPage: пустой сегодняшний день", () => {
  beforeEach(() => vi.clearAllMocks());

  // Релизов «сегодня» может не быть вовсе (выходные, поздний вечер). Стартовая
  // вкладка тогда показывала бы «нет событий», хотя дальше в окне их десятки —
  // именно так календарь и выглядел пустым по воскресеньям.
  it("автоматически открывает ближайшие 7 дней, когда на сегодня событий нет", async () => {
    const later = new Date(Date.now() + 3 * 86_400_000);
    mockFetch({
      events: [{ ...events[0], id: "later", time: later.toISOString() }],
      currencies: ["USD"],
      categories: ["Inflation"],
    });

    render(<EconCalPage />);
    expect(await screen.findByText("Базовый ИПЦ (м/м)")).toBeInTheDocument();
  });

  it("не подменяет вкладку, если её выбрал пользователь", async () => {
    const later = new Date(Date.now() + 3 * 86_400_000);
    mockFetch({
      events: [{ ...events[0], id: "later", time: later.toISOString() }],
      currencies: ["USD"],
      categories: ["Inflation"],
    });

    render(<EconCalPage />);
    await screen.findByText("Базовый ИПЦ (м/м)");

    fireEvent.click(screen.getByText("econcal.today", { selector: "button" }));
    await waitFor(() => expect(screen.queryByText("Базовый ИПЦ (м/м)")).not.toBeInTheDocument());
  });
});
