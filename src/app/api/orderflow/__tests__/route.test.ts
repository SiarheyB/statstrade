import { describe, it, expect, vi, beforeEach } from "vitest";
import { asUser, asGuest, mockGetAuthUser } from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/orderflow/route";

vi.mock("@/lib/orderflow", () => ({
  CANDLES_IN_WINDOW: {
    "5m": 400,
    "15m": 400,
    "1h": 800,
    "4h": 800,
    "12h": 800,
    "1d": 365,
    "1w": 200,
  },
  DEFAULT_CANDLES: 300,
  TF_MS: {
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "4h": 4 * 60 * 60_000,
    "12h": 12 * 60 * 60_000,
    "1d": 24 * 60 * 60_000,
    "1w": 7 * 24 * 60 * 60_000,
  },
  // Настоящая orderflowWindow: границы окна — часть контракта роута (по ним
  // вторая фаза загрузки встаёт на сетку первой), подменять их нечем.
  orderflowWindow: (range: string, toMs = Date.now()) => {
    const tf: Record<string, number> = {
      "5m": 5 * 60_000, "15m": 15 * 60_000, "1h": 60 * 60_000, "4h": 4 * 60 * 60_000,
      "12h": 12 * 60 * 60_000, "1d": 24 * 60 * 60_000, "1w": 7 * 24 * 60 * 60_000,
    };
    const w: Record<string, number> = {
      "5m": 400, "15m": 400, "1h": 800, "4h": 800, "12h": 800, "1d": 365, "1w": 200,
    };
    if (!tf[range]) return null;
    return { from: toMs - tf[range] * (w[range] ?? 300), to: toMs, tf: tf[range] };
  },
  computeOrderflow: vi.fn().mockResolvedValue({ bins: [], maxVol: 0 }),
  fetchOrderflowCandles: vi.fn().mockResolvedValue([]),
  computeDelta: vi.fn().mockResolvedValue({ series: [] }),
  computeFootprint: vi.fn().mockResolvedValue({ candles: [] }),
  computeBA: vi.fn().mockResolvedValue({ series: [] }),
  computeBigTrades: vi.fn().mockResolvedValue([]),
}));

const base = "https://example.com/api/orderflow";

describe("GET /api/orderflow", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=1h`));
    expect(res.status).toBe(401);
  });

  it("returns 400 for unknown timeframe", async () => {
    asUser();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=9h`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("таймфрейм") });
  });

  it("returns 400 for too-short symbol", async () => {
    asUser();
    const res = await GET(new Request(`${base}?symbol=BTC&range=1h`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("символ") });
  });

  it("returns 400 for invalid timezone", async () => {
    asUser();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=1h&tz=Mars/Phobos`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("часовой пояс") });
  });

  it("returns 200 with assembled payload for a valid request", async () => {
    asUser();
    const res = await GET(
      new Request(`${base}?symbol=BTCUSDT&exchange=binance-futures&range=1h`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("BTCUSDT");
    expect(body.exchange).toBe("binance-futures");
    expect(body.range).toBe("1h");
    expect(body.heatmap).toBeDefined();
    expect(body.candles).toEqual([]);
    expect(body.timezone).toBe("auto");
  });

  // Перенесено из src/lib/orderflow.test.ts — тот файл тестировал этот же роут,
  // но лежал в lib и мокал buildPayload, которой в @/lib/orderflow нет (она
  // приватная в самом роуте). Мок ничего не подменял, тесты проходили по
  // другой причине, чем заявлено в их шапке.
  it("возвращает переданную таймзону в ответе", async () => {
    asUser();
    const res = await GET(
      new Request(`${base}?symbol=ETHUSDT&exchange=binance-futures&range=1h&tz=UTC%2B3`),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).timezone).toBe("UTC+3");
  });

  it("повторный запрос в пределах TTL берётся из кэша, а не считается заново", async () => {
    asUser();
    const { computeOrderflow } = await import("@/lib/orderflow");
    const calls = () => (computeOrderflow as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    const url = `${base}?symbol=SOLUSDT&exchange=binance-futures&range=4h`;
    await GET(new Request(url));
    const after = calls();
    await GET(new Request(url));
    // Второй заход не должен запускать тяжёлую агрегацию повторно.
    expect(calls()).toBe(after);
  });

  it("другой символ считается отдельно (кэш не путает ключи)", async () => {
    asUser();
    const { computeOrderflow } = await import("@/lib/orderflow");
    const calls = () => (computeOrderflow as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    await GET(new Request(`${base}?symbol=ADAUSDT&exchange=binance-futures&range=1d`));
    const after = calls();
    await GET(new Request(`${base}?symbol=DOTUSDT&exchange=binance-futures&range=1d`));
    expect(calls()).toBe(after + 1);
  });

  // ─── Две фазы загрузки (см. ORDERFLOW_PERF_PLAN.md, §5) ──────────────────

  it("candles=0 не тянет свечи: их уже забрала первая фаза", async () => {
    asUser();
    const { fetchOrderflowCandles } = await import("@/lib/orderflow");
    const calls = () => (fetchOrderflowCandles as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    const before = calls();
    const res = await GET(new Request(`${base}?symbol=XRPUSDT&range=1h&candles=0`));
    expect(res.status).toBe(200);
    expect(calls()).toBe(before);
    expect((await res.json()).candles).toBeNull();
  });

  it("принимает границу окна `to` от первой фазы", async () => {
    asUser();
    const to = Date.now() - 500;
    const res = await GET(new Request(`${base}?symbol=LTCUSDT&range=1h&candles=0&to=${to}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.to).toBe(to);
    // from обязан лежать на той же сетке: окно = 800 часов от переданного to.
    expect(body.from).toBe(to - 800 * 60 * 60_000);
  });

  it("отклоняет `to` вне окрестности «сейчас» — это был бы запрос по чужому диапазону", async () => {
    asUser();
    const res = await GET(
      new Request(`${base}?symbol=LTCUSDT&range=1h&to=${Date.now() - 30 * 86_400_000}`),
    );
    expect(res.status).toBe(400);
  });

  it("запросы со свечами и без них кэшируются раздельно", async () => {
    asUser();
    const { computeOrderflow } = await import("@/lib/orderflow");
    const calls = () => (computeOrderflow as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    await GET(new Request(`${base}?symbol=AVAXUSDT&range=1d`));
    const after = calls();
    // Тот же ключ, но без свечей — payload другой формы, отдавать из общего
    // кэша его нельзя.
    await GET(new Request(`${base}?symbol=AVAXUSDT&range=1d&candles=0`));
    expect(calls()).toBe(after + 1);
  });
});
