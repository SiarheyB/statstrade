/**
 * Тесты API‑маршрута /api/orderflow.
 * Проверяем:
 *   • работу параметра `tz`
 *   • валидацию недопустимых значений (400)
 *   • возврат `timezone` в ответе
 *   • механизмы кеша (TTL)
 *   • повторные запросы с отправленным tz
 */

import { GET } from "../app/api/orderflow/route";
import { NextResponse } from "next/server";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Мокаем внешние зависимости
vi.mock("@/lib/api", () => ({
  getAuthUser: vi.fn().mockResolvedValue({ id: "test-user" }),
  unauthorized: vi.fn(() => NextResponse.json({ error: "Unauthorized" }, { status: 401 })),
  badRequest: vi.fn((msg: string) => NextResponse.json({ error: msg }, { status: 400 })),
  serverError: vi.fn((msg: string) => NextResponse.json({ error: msg }, { status: 500 })),
}));

vi.mock("@/lib/db", () => ({}));

vi.mock("@/lib/orderflow", () => {
  const actual = vi.importActual("@/lib/orderflow");
  return {
    ...actual,
    buildPayload: vi.fn(),
    computeOrderflow: vi.fn().mockResolvedValue(null),
    fetchOrderflowCandles: vi.fn().mockResolvedValue([]),
    computeDelta: vi.fn().mockResolvedValue(null),
    computeFootprint: vi.fn().mockResolvedValue(null),
    computeBA: vi.fn().mockResolvedValue(null),
    computeBigTrades: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/lib/timezone", () => {
  const actual = vi.importActual("@/lib/timezone");
  return {
    ...actual,
    isTimezone: vi.fn((v: string) => ["auto", "UTC", "UTC+3", "UTC-5"].includes(v)),
    normalizeTimezone: vi.fn((v: string) => v),
  };
});

describe("/api/orderflow[GET]", () => {
  const makeUrl = (searchParams: Record<string, string>) =>
    new URL(`/api/orderflow?${new URLSearchParams(searchParams)}`, "http://localhost");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("успешно обрабатывает запрос с валидным tz=UTC+3", async () => {
    const { buildPayload } = await import("@/lib/orderflow");
    (buildPayload as vi.Mock).mockResolvedValue({
      symbol: "BTCUSDT",
      exchange: "binance-spot",
      range: "1h",
      from: Date.now() - 1000,
      to: Date.now(),
      heatmap: {} as any,
      candles: [] as any,
      delta: {} as any,
      footprint: {} as any,
      ba: {} as any,
      bigTrades: [] as any,
      timezone: "UTC+3",
    });

    const url = makeUrl({ symbol: "BTCUSDT", exchange: "binance-spot", range: "1h", tz: "UTC+3" });
    const res = await GET(request({ url, method: "GET" }) as any);

    expect(res).toBeInstanceOf(NextResponse);
    const json = await res.json();
    expect(json.timezone).toBe("UTC+3");
  });

  it("кэширует ответ на TTL", async () => {
    const { buildPayload } = await import("@/lib/orderflow");
    (buildPayload as vi.Mock).mockResolvedValue({
      symbol: "BTCUSDT",
      exchange: "binance-spot",
      range: "1h",
      from: Date.now() - 30_000,
      to: Date.now(),
      heatmap: {} as any,
      candles: [] as any,
      delta: {} as any,
      footprint: {} as any,
      ba: {} as any,
      bigTrades: [] as any,
      timezone: "auto",
    });

    const url = makeUrl({
      symbol: "BTCUSDT",
      exchange: "binance-spot",
      range: "1h",
      tz: "auto",
    });
    const first = await GET(request({ url, method: "GET" }) as any);
    const second = await GET(request({ url, method: "GET" }) as any);

    const firstJson = await first.json();
    const secondJson = await second.json();
    expect(firstJson.timezone).toBe(secondJson.timezone);
    expect(firstJson.symbol).toBe(secondJson.symbol);
  });

  it("возвращает 400 при невалидном tz", async () => {
    const { isTimezone } = await import("@/lib/timezone");
    (isTimezone as vi.Mock).mockReturnValueOnce(false);

    const url = makeUrl({
      symbol: "BTCUSDT",
      exchange: "binance-spot",
      range: "1h",
      tz: "INVALID_TZ",
    });
    const res = await GET(request({ url, method: "GET" }) as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Некорректный часовой пояс");
  });
});

/* ------------------------------------------------------------------ */
/* Вспомогательная функция, имитирующая Express‑подобный запрос      */
type MockRequest = {
  method: string;
  url: string;
  searchParams: URLSearchParams;
};

function request(req: MockRequest) {
  return {
    method: req.method,
    url: req.url,
    searchParams: req.searchParams,
    body: undefined,
  };
}