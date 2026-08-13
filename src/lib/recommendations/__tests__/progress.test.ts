import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../recompute", () => ({ recomputeRecommendations: vi.fn() }));
vi.mock("../candleScan", () => ({ refreshDailyCandles: vi.fn() }));

import { recomputeRecommendations, type RecomputeCallbacks } from "../recompute";
import { refreshDailyCandles } from "../candleScan";
import { getRecomputeProgress, resetRecomputeProgress, startRecompute } from "../progress";

const mockRecompute = vi.mocked(recomputeRecommendations);
const mockScan = vi.mocked(refreshDailyCandles);

/** Даёт фоновому промису пройти await-и до следующего шага. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("recompute progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRecomputeProgress();
    // По умолчанию загрузка свечей отрабатывает мгновенно и успешно —
    // отдельные кейсы ниже переопределяют это поведение.
    mockScan.mockResolvedValue({ ok: true, done: 527, total: 527 });
  });

  it("starts idle", () => {
    expect(getRecomputeProgress()).toMatchObject({ phase: "idle", running: false, processed: 0, total: 0 });
  });

  it("tracks phases and per-symbol progress while running", async () => {
    // Пересчёт держим «в полёте», пока вручную дёргаем колбэки: иначе он
    // завершился бы сразу и прогресс успел бы схлопнуться в done.
    let cbs: RecomputeCallbacks = {};
    let finish!: (r: Awaited<ReturnType<typeof recomputeRecommendations>>) => void;
    mockRecompute.mockImplementation((callbacks = {}) => {
      cbs = callbacks;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });

    const { started, done } = startRecompute();
    expect(started).toBe(true);
    // Первый этап — загрузка свечей с биржи, ещё до анализа.
    expect(getRecomputeProgress()).toMatchObject({ phase: "fetching", running: true });

    await flush(); // даём пройти await refreshDailyCandles()

    // Колбэки дёргаем вручную — так проверяется именно проводка прогресса,
    // без зависимости от реального пересчёта.
    cbs.onSymbolsListed?.(2);
    expect(getRecomputeProgress()).toMatchObject({ phase: "scanning", total: 2, running: true });

    cbs.onSymbolStart?.("BTCUSDT", 0);
    expect(getRecomputeProgress()).toMatchObject({ currentSymbol: "BTCUSDT", processed: 0 });

    cbs.onSymbolDone?.("BTCUSDT", 0, 2);
    expect(getRecomputeProgress()).toMatchObject({ processed: 1, levelsFound: 2 });

    cbs.onWriteStart?.();
    expect(getRecomputeProgress()).toMatchObject({ phase: "writing", currentSymbol: null });

    finish({ symbolsScanned: 2, levelsWritten: 3, neutralSkipped: 1, candidates: 5, rejected: { level_chopped: 4 } });
    await done;
    expect(getRecomputeProgress()).toMatchObject({
      phase: "done",
      running: false,
      processed: 2,
      // По итогам показываем, сколько прошло фильтр качества.
      levelsFound: 5,
      result: { symbolsScanned: 2, levelsWritten: 3, neutralSkipped: 1, candidates: 5 },
    });
  });

  it("does not start a second run while one is in flight", async () => {
    mockRecompute.mockReturnValueOnce(new Promise(() => {}));

    expect(startRecompute().started).toBe(true);
    expect(startRecompute().started).toBe(false);
    await flush();
    expect(mockRecompute).toHaveBeenCalledTimes(1);
    expect(getRecomputeProgress().running).toBe(true);
  });

  it("fetches fresh candles from the exchange BEFORE analysing", async () => {
    const order: string[] = [];
    mockScan.mockImplementation(async (onProgress) => {
      order.push("scan");
      onProgress?.(100, 527);
      return { ok: true, done: 527, total: 527 };
    });
    mockRecompute.mockImplementation(async () => {
      order.push("recompute");
      return { symbolsScanned: 1, levelsWritten: 1, neutralSkipped: 0, candidates: 1, rejected: {} };
    });

    await startRecompute().done;
    expect(order).toEqual(["scan", "recompute"]);
    expect(getRecomputeProgress().candleScan).toMatchObject({ done: 527, total: 527, skippedReason: null });
  });

  it("still recomputes when the collector is unavailable, and says so", async () => {
    mockScan.mockResolvedValue({ ok: false, done: 0, total: 0, skippedReason: "collector /scan-daily HTTP 502" });
    mockRecompute.mockResolvedValue({
      symbolsScanned: 1,
      levelsWritten: 1,
      neutralSkipped: 0,
      candidates: 1,
      rejected: {},
    });

    await startRecompute().done;
    expect(mockRecompute).toHaveBeenCalledTimes(1);
    expect(getRecomputeProgress()).toMatchObject({
      phase: "done",
      candleScan: { skippedReason: "collector /scan-daily HTTP 502" },
    });
  });

  it("records the failure instead of leaving the job stuck as running", async () => {
    mockRecompute.mockRejectedValueOnce(new Error("boom"));

    const { done } = startRecompute();
    await expect(done).rejects.toThrow("boom");

    expect(getRecomputeProgress()).toMatchObject({ phase: "error", running: false, error: "boom" });
    // После падения можно запустить снова.
    mockRecompute.mockReturnValueOnce(new Promise(() => {}));
    expect(startRecompute().started).toBe(true);
  });
});
