import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { asUser, asGuest, mockGetAuthUser, mockPrisma } from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/orderflow/history/route";

const base = "https://example.com/api/orderflow/history";

// Догрузка истории теперь умеет добирать свечи с биржи, когда в ObCandle их
// ещё нет (иначе на 5m скролл влево упирался в пустоту — см. комментарий в
// lib/orderflow.ts). Поэтому сеть в этих тестах обязательно мокаем: без мока
// набор реально ходил в Binance.
const realFetch = global.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

function klines(count: number, endMs: number, stepMs: number) {
  return Array.from({ length: count }, (_, i) => {
    const t = endMs - (count - i) * stepMs;
    return [t, "100", "101", "99", "100.5", "10"];
  });
}

function okKlines(rows: unknown[]) {
  return { ok: true, json: async () => rows } as unknown as Response;
}

// Уникальный курсор на каждый тест: у роута есть кэш ответов на 60с, и
// одинаковый before отдал бы результат предыдущего теста.
let cursor = 1_700_000_000_000;
function nextBefore() {
  cursor += 7 * 24 * 3600_000;
  return cursor;
}

describe("GET /api/orderflow/history", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.obCandle.findMany.mockReset().mockResolvedValue([]);
    fetchMock = vi.fn().mockResolvedValue(okKlines([]));
    global.fetch = fetchMock as unknown as typeof fetch;
    asUser();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=1h&before=${nextBefore()}`));
    expect(res.status).toBe(401);
  });

  it("returns 400 for unknown timeframe", async () => {
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=3m&before=${nextBefore()}`));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid symbol (too short)", async () => {
    const res = await GET(new Request(`${base}?symbol=BTC&range=1h&before=${nextBefore()}`));
    expect(res.status).toBe(400);
  });

  it("returns 400 when before is missing/invalid", async () => {
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=1h`));
    expect(res.status).toBe(400);
  });

  it("returns 200 with candles and hasMore on the happy path", async () => {
    const before = nextBefore();
    const rows = Array.from({ length: 500 }, (_, i) => ({
      t: new Date(before - (i + 1) * 3600_000),
      o: 100,
      h: 101,
      l: 99,
      c: 100.5,
    }));
    mockPrisma.obCandle.findMany.mockResolvedValue(rows);
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&exchange=binance-futures&range=1h&before=${before}&limit=500`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candles.length).toBe(500);
    expect(body.hasMore).toBe(true);
    // Полная страница из БД — на биржу ходить незачем.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ─── Догрузка с биржи, когда история в БД ещё не заполнена ────────────────
  // Ровно этот случай ломал 5m: ObCandle держит только ширину окна
  // (CANDLES_IN_WINDOW), и скролл влево получал 0 свечей и hasMore=false.

  it("добирает свечи с биржи, когда в БД для этого отрезка пусто", async () => {
    const before = nextBefore();
    fetchMock.mockResolvedValue(okKlines(klines(500, before, 5 * 60_000)));
    const res = await GET(
      new Request(`${base}?symbol=BTCUSDT&exchange=binance-futures&range=5m&before=${before}&limit=500`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candles.length).toBe(500);
    expect(body.hasMore).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("interval=5m");
    expect(url).toContain(`endTime=${before - 1}`);
    // И кладём добранное в ObCandle, чтобы следующий скролл шёл уже из БД.
    expect(mockPrisma.$executeRaw).toHaveBeenCalled();
  });

  it("не отдаёт свечи новее курсора", async () => {
    const before = nextBefore();
    // Биржа вернула лишнего — бар ровно на курсоре и один после него.
    fetchMock.mockResolvedValue(
      okKlines([
        [before - 3600_000, "1", "2", "0.5", "1.5", "1"],
        [before, "1", "2", "0.5", "1.5", "1"],
        [before + 3600_000, "1", "2", "0.5", "1.5", "1"],
      ]),
    );
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=1h&before=${before}&limit=500`));
    const body = await res.json();
    expect(body.candles.every((c: { t: number }) => c.t < before)).toBe(true);
    expect(body.candles.length).toBe(1);
  });

  it("для биржи без klines-API остаётся пустой ответ", async () => {
    const before = nextBefore();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&exchange=okx&range=1h&before=${before}&limit=500`));
    const body = await res.json();
    expect(body.candles).toEqual([]);
    expect(body.hasMore).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("падение БД не роняет ответ", async () => {
    mockPrisma.obCandle.findMany.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&exchange=okx&range=1h&before=${nextBefore()}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candles).toEqual([]);
    expect(body.hasMore).toBe(false);
  });

  // ─── Наложения едут вместе со срезом ─────────────────────────────────────

  it("отдаёт heatmap и футпринт для своего отрезка", async () => {
    const before = nextBefore();
    fetchMock.mockResolvedValue(okKlines(klines(10, before, 5 * 60_000)));
    const res = await GET(
      new Request(`${base}?symbol=BTCUSDT&exchange=binance-futures&range=5m&before=${before}&limit=500`),
    );
    const body = await res.json();
    expect(body.candles.length).toBe(10);
    // Прайс-данных в моке БД нет, поэтому сами наложения пустые — важно, что
    // поля присутствуют в контракте, а не отсутствуют как раньше.
    expect(body).toHaveProperty("heatmap");
    expect(body).toHaveProperty("footprint");
  });

  it("overlays=0 не считает наложения вовсе", async () => {
    const before = nextBefore();
    fetchMock.mockResolvedValue(okKlines(klines(10, before, 3600_000)));
    const res = await GET(
      new Request(`${base}?symbol=BTCUSDT&range=1h&before=${before}&limit=500&overlays=0`),
    );
    const body = await res.json();
    expect(body.heatmap).toBeNull();
    expect(body.footprint).toBeNull();
  });
});
