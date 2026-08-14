import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildHeatmap, fetchKlines, computeLiqMap, type Kline } from "@/lib/liqmap";

const klines: Kline[] = [
  { time: 1, open: 100, high: 110, low: 90, close: 100, quoteVol: 1000 },
  { time: 2, open: 100, high: 120, low: 80, close: 110, quoteVol: 2000 },
  { time: 3, open: 110, high: 115, low: 95, close: 105, quoteVol: 1500 },
];

describe("liqmap buildHeatmap", () => {
  it("returns null for empty input", () => {
    expect(buildHeatmap([])).toBeNull();
  });

  it("builds a grid with the last close as price", () => {
    const hm = buildHeatmap(klines);
    expect(hm).not.toBeNull();
    expect(hm!.bins).toBe(160);
    expect(hm!.cols).toBe(3); // min(140, n)
    expect(hm!.price).toBe(105);
    expect(hm!.candles).toHaveLength(3);
    const total = hm!.grid.flat().reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("honours a fixed range and custom dimensions", () => {
    const hm = buildHeatmap(klines, { range: [50, 150], bins: 50, cols: 10 });
    expect(hm!.priceMin).toBe(50);
    expect(hm!.priceMax).toBe(150);
    expect(hm!.bins).toBe(50);
    expect(hm!.cols).toBe(3); // min(10, n)
  });
});

describe("liqmap: поиск первого касания уровня", () => {
  // Поиск «когда уровень ликвидации будет сметён» переведён с линейного скана
  // (O(n²·L)) на разреженные таблицы + бинарный поиск. Эти кейсы фиксируют
  // именно поведение поиска: полоса обязана обрываться на первом касании.
  const k = (close: number, high: number, low: number, quoteVol = 1000) => ({
    time: 0, open: close, high, low, close, quoteVol,
  });

  it("полоса гаснет, когда цена доходит до уровня", () => {
    // Одна свеча с объёмом, затем свечи, пробивающие уровень вниз.
    const klines = [
      k(100, 101, 99, 1000),
      k(100, 101, 99, 0),
      // Свеча, пробивающая уровни в ОБЕ стороны: long-уровни лежат ниже цены
      // входа (3x → ~67), short-уровни — выше (3x → ~133).
      k(100, 200, 50, 0),
      k(60, 61, 59, 0),
    ];
    const hm = buildHeatmap(klines, { bins: 20, cols: 4 })!;
    const colSum = (c: number) => hm.grid[c].reduce((a, b) => a + b, 0);
    // До касания полосы горят, после — гаснут.
    expect(colSum(0)).toBeGreaterThan(0);
    expect(colSum(3)).toBe(0);
  });

  it("нетронутый уровень горит до конца окна", () => {
    // Диапазон последующих свечей УЖЕ самой близкой ликвидации: у 100x она
    // всего в 0.6% от входа (1/100 − mmr), поэтому high=101 её бы уже задел.
    const klines = [
      k(100, 100.01, 99.99, 1000),
      k(100, 100.01, 99.99, 0),
      k(100, 100.01, 99.99, 0),
      k(100, 100.01, 99.99, 0),
    ];
    const hm = buildHeatmap(klines, { bins: 20, cols: 4 })!;
    const colSum = (c: number) => hm.grid[c].reduce((a, b) => a + b, 0);
    // Цена никуда не ушла — ни один уровень не сметён.
    expect(colSum(3)).toBeGreaterThan(0);
    expect(colSum(0)).toBeCloseTo(colSum(3), 9);
  });

  it("свечи с нулевым объёмом не создают полос", () => {
    const hm = buildHeatmap([k(100, 101, 99, 0), k(100, 101, 99, 0)], { bins: 10, cols: 2 })!;
    expect(hm.maxVal).toBe(0);
  });

  it("массив из одной свечи не ломает поиск", () => {
    const hm = buildHeatmap([k(100, 101, 99, 1000)], { bins: 10, cols: 1 })!;
    expect(hm.maxVal).toBeGreaterThan(0);
  });
});

describe("liqmap fetchKlines / computeLiqMap", () => {
  const mockFetch = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch as unknown as typeof fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it("fetches + parses binance klines", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [[1, 100, 110, 90, 100, 0, 0, 1000]],
    });
    const kl = await fetchKlines("binance", "BTCUSDT", "1d");
    expect(kl).toHaveLength(1);
    expect(kl[0].quoteVol).toBe(1000);
  });

  it("fetches + parses bybit klines (reversed list)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: { list: [["2", "100", "120", "80", "110", "0", "2000"]] } }),
    });
    const kl = await fetchKlines("bybit", "BTCUSDT", "1d");
    expect(kl[0].close).toBe(110);
    expect(kl[0].quoteVol).toBe(2000);
  });

  it("fetches + parses okx klines", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [["3", "110", "115", "95", "105", "0", "0", "1500"]] }),
    });
    const kl = await fetchKlines("okx", "BTCUSDT", "1d");
    expect(kl[0].close).toBe(105);
  });

  it("throws on a non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(fetchKlines("binance", "BTCUSDT", "1d")).rejects.toThrow(/HTTP 500/);
  });

  it("computes a single-exchange heatmap", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [[1, 100, 110, 90, 100, 0, 0, 1000]],
    });
    const hm = await computeLiqMap("binance", "BTCUSDT", "1d");
    expect(hm).not.toBeNull();
  });

  it("aggregates all three exchanges onto a shared range", async () => {
    mockFetch.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes("binance"))
        return { ok: true, json: async () => [[1, 100, 110, 90, 100, 0, 0, 1000]] };
      if (u.includes("bybit"))
        return { ok: true, json: async () => ({ result: { list: [["2", "100", "120", "80", "110", "0", "0", "2000"]] } }) };
      return { ok: true, json: async () => ({ data: [["3", "110", "115", "95", "105", "0", "0", "1500"]] }) };
    });
    const hm = await computeLiqMap("all", "BTCUSDT", "1d");
    expect(hm).not.toBeNull();
    expect(hm!.cols).toBeGreaterThan(0);
  });

  it("returns null when every exchange fetch fails", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    const hm = await computeLiqMap("all", "BTCUSDT", "1d");
    expect(hm).toBeNull();
  });
});
