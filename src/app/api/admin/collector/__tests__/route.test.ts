import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";

const base = "https://example.com/api/admin/collector";

describe("GET /api/admin/collector", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    mockGetAdminSession.mockReset();
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ n: 0 }]);
    mockPrisma.obLatestBook.findUnique.mockReset().mockResolvedValue(null);
    ({ GET } = await import("@/app/api/admin/collector/route"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.COLLECTOR_URL;
    delete process.env.COLLECTOR_METRICS_TOKEN;
  });

  it("returns 404 when not an admin", async () => {
    asNonAdmin();
    const res = await GET(new Request(base));
    expect(res.status).toBe(404);
  });

  it("returns 200 with graceful collector fallback when collector env is unset", async () => {
    asAdmin();
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.feeds).toEqual([]);
    expect(body.collector.ok).toBe(false);
  });

  it("returns 200 and surfaces collector metrics when available", async () => {
    asAdmin();
    process.env.COLLECTOR_URL = "http://collector";
    process.env.COLLECTOR_METRICS_TOKEN = "tok";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ synced: true, resync: false }),
      }),
    );
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.collector.ok).toBe(true);
  });

  // Раньше live-превью считалось двумя проходами по сырому ObSnapshot
  // (коррелированный max(t) внутри выборки плюс отдельный max(t) рядом), и оба
  // шли мимо серверного кэша — то есть на КАЖДЫЙ опрос админки.
  it("live-превью читает ObLatestBook, а не сканирует ObSnapshot", async () => {
    asAdmin();
    mockPrisma.obLatestBook.findUnique.mockResolvedValue({
      t: new Date("2026-08-29T10:00:00Z"),
      levels: [
        { price: 2, bidVol: 1, askVol: 0 },
        { price: 1, bidVol: 3, askVol: 4 },
      ],
    });

    const res = await GET(new Request(`${base}?symbol=BTCUSDT&exchange=binance-futures`));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockPrisma.obLatestBook.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { symbol_exchange: { symbol: "BTCUSDT", exchange: "binance-futures" } },
      }),
    );
    // Уровни отдаются по возрастанию цены — как это делал ORDER BY price.
    expect(body.preview.bins.map((b: { price: number }) => b.price)).toEqual([1, 2]);
    expect(body.preview.t).toContain("2026-08-29");
  });

  it("пустая ObLatestBook даёт пустое превью, а не ошибку", async () => {
    asAdmin();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&exchange=binance-futures`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.preview.bins).toEqual([]);
    expect(body.preview.t).toBeNull();
  });
});
