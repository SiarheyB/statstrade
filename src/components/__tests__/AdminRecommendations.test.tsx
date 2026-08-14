import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import AdminRecommendations from "@/components/AdminRecommendations";
import { setFormatLocale, setFormatTimezone } from "@/lib/format";

type Progress = Record<string, unknown>;

function status(progress: Progress, overrides: Record<string, unknown> = {}) {
  return {
    total: 12,
    symbolsCovered: 3,
    byBias: { breakout: 7, false_breakout: 5 },
    byDirection: { long: 8, short: 4 },
    lastComputedAt: "2026-08-13T12:00:00.000Z",
    lastCandlesTo: "2026-08-12T00:00:00.000Z",
    progress,
    schedule: {
      dailyCloseUtcHour: 0,
      delayMinutes: 5,
      nextRunAt: "2026-08-14T00:05:00.000Z",
      schedulerInProcess: false,
      // Прод-расклад: планировщик в процессе выключен, но крон хоста приходил —
      // автоматика живая, красной плашки быть не должно.
      lastAutoRunAt: new Date(Date.now() - 3600_000).toISOString(),
      lastAutoRunSource: "cron",
      autoStale: false,
    },
    ...overrides,
  };
}

const idleProgress: Progress = {
  phase: "idle",
  running: false,
  processed: 0,
  total: 0,
  currentSymbol: null,
  levelsFound: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
  result: null,
  candleScan: null,
};

function mockFetch(statusBody: ReturnType<typeof status>) {
  return vi.fn(async (url: string) => {
    if (typeof url === "string" && url.startsWith("/api/admin/features")) {
      return { ok: true, json: async () => ({ features: [] }) } as unknown as Response;
    }
    return { ok: true, json: async () => statusBody } as unknown as Response;
  });
}

describe("AdminRecommendations", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch(status(idleProgress)));
    // Локаль и часовой пояс — модульное состояние format.ts; фиксируем на
    // каждый кейс, чтобы тесты не зависели от настроек машины и друг от друга
    // (ru-RU даёт 24-часовое время).
    setFormatLocale("ru");
    setFormatTimezone("UTC");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows long/short counts and no neutral bucket", async () => {
    render(<AdminRecommendations />);
    expect(await screen.findByText("Лонг: 8")).toBeInTheDocument();
    expect(screen.getByText("Шорт: 4")).toBeInTheDocument();
    expect(screen.getByText("Пробой: 7")).toBeInTheDocument();
    expect(screen.queryByText(/Нейтрально:/)).not.toBeInTheDocument();
  });

  it("hides the progress bar while idle", async () => {
    render(<AdminRecommendations />);
    await screen.findByText("Лонг: 8");
    expect(screen.queryByText(/пар ·/)).not.toBeInTheDocument();
  });

  it("renders scan progress with phase, counters and current symbol", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        status({
          ...idleProgress,
          phase: "scanning",
          running: true,
          processed: 30,
          total: 120,
          currentSymbol: "ETHUSDT",
          levelsFound: 44,
          startedAt: "2026-08-13T12:00:00.000Z",
        }),
      ),
    );

    render(<AdminRecommendations />);
    expect(await screen.findByText("Считаем уровни и сигналы")).toBeInTheDocument();
    expect(screen.getByText("30 / 120 пар · 25%")).toBeInTheDocument();
    expect(screen.getByText("Сейчас: ETHUSDT")).toBeInTheDocument();
    expect(screen.getByText("Найдено уровней: 44")).toBeInTheDocument();
    // Кнопка запуска заблокирована, пока идёт пересчёт.
    expect(screen.getByRole("button", { name: /Идёт пересчёт/ })).toBeDisabled();
  });

  it("reports the finished run, including how many neutral setups were dropped", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        status({
          ...idleProgress,
          phase: "done",
          processed: 120,
          total: 120,
          levelsFound: 12,
          result: { symbolsScanned: 120, levelsWritten: 12, neutralSkipped: 37 },
        }),
      ),
    );

    render(<AdminRecommendations />);
    await waitFor(() => expect(screen.getByText("Готово")).toBeInTheDocument());
    expect(screen.getByText(/отброшено нейтральных: 37/)).toBeInTheDocument();
  });

  it("shows when the next automatic recompute happens, in the viewer's timezone", async () => {
    setFormatTimezone("UTC+3");
    render(<AdminRecommendations />);

    // 00:05 UTC следующих суток = 03:05 при UTC+3.
    expect(await screen.findByText(/Автопересчёт работает/)).toBeInTheDocument();
    expect(screen.getByText("03:05")).toBeInTheDocument();
    expect(screen.getByText(/после закрытия дневной свечи Binance \(00:00 UTC\)/)).toBeInTheDocument();
  });

  it("renders the same instant shifted for another timezone", async () => {
    setFormatTimezone("UTC-5");
    render(<AdminRecommendations />);

    // Тот же UTC-момент, другая зона: 00:05 UTC = 19:05 предыдущего дня.
    expect(await screen.findByText("19:05")).toBeInTheDocument();
  });

  // ENABLE_SCHEDULER=false сам по себе НЕ повод для тревоги: на самохостинге он
  // выключен намеренно, а пересчёт дёргает крон хоста. Красное — только когда
  // прогонов реально нет.
  it("не ругается на выключенный внутренний планировщик, если крон приходит", async () => {
    render(<AdminRecommendations />);

    expect(await screen.findByText(/Автопересчёт работает/)).toBeInTheDocument();
    expect(screen.getByText(/системный крон хоста/)).toBeInTheDocument();
    expect(screen.queryByText(/ENABLE_SCHEDULER/)).not.toBeInTheDocument();
  });

  it("предупреждает, когда автопересчёт ни разу не запускался", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        status(idleProgress, {
          schedule: {
            dailyCloseUtcHour: 0,
            delayMinutes: 5,
            nextRunAt: "2026-08-14T00:05:00.000Z",
            schedulerInProcess: false,
            lastAutoRunAt: null,
            lastAutoRunSource: null,
            autoStale: true,
          },
        }),
      ),
    );

    render(<AdminRecommendations />);
    expect(await screen.findByText(/ни разу не запускался/)).toBeInTheDocument();
    // Подсказка ведёт к настоящей причине — задаче в crontab, а не к env-переменной.
    expect(screen.getByText(/crontab -l \| grep recommendations/)).toBeInTheDocument();
  });

  it("предупреждает, когда прогоны прекратились", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        status(idleProgress, {
          schedule: {
            dailyCloseUtcHour: 0,
            delayMinutes: 5,
            nextRunAt: "2026-08-14T00:05:00.000Z",
            schedulerInProcess: false,
            lastAutoRunAt: new Date(Date.now() - 3 * 24 * 3600_000).toISOString(),
            lastAutoRunSource: "cron",
            autoStale: true,
          },
        }),
      ),
    );

    render(<AdminRecommendations />);
    expect(await screen.findByText(/не приходил больше суток/)).toBeInTheDocument();
  });

  it("shows a candle download that the collector started on its own", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        status(idleProgress, {
          collectorScan: { running: true, done: 333, total: 683, startedAt: null, finishedAt: null, error: null },
        }),
      ),
    );

    render(<AdminRecommendations />);
    expect(await screen.findByText(/Коллектор качает дневные свечи/)).toBeInTheDocument();
    expect(screen.getByText("333 / 683 пар · 49%")).toBeInTheDocument();
  });

  it("does not show the collector line when nothing is being downloaded", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        status(idleProgress, {
          collectorScan: { running: false, done: 683, total: 683, startedAt: null, finishedAt: null, error: null },
        }),
      ),
    );

    render(<AdminRecommendations />);
    await screen.findByText("Лонг: 8");
    expect(screen.queryByText(/Коллектор качает дневные свечи/)).not.toBeInTheDocument();
  });

  it("does not duplicate the download line while our own recompute is fetching", async () => {
    // Пересчёт, запущенный отсюда, уже показывает этап «Загружаем свечи» —
    // второй индикатор про то же самое был бы шумом.
    vi.stubGlobal(
      "fetch",
      mockFetch(
        status(
          { ...idleProgress, phase: "fetching", running: true, candleScan: { done: 100, total: 683, skippedReason: null } },
          { collectorScan: { running: true, done: 100, total: 683, startedAt: null, finishedAt: null, error: null } },
        ),
      ),
    );

    render(<AdminRecommendations />);
    expect(await screen.findByText("Загружаем свежие свечи с Binance")).toBeInTheDocument();
    expect(screen.queryByText(/Коллектор качает дневные свечи/)).not.toBeInTheDocument();
  });

  it("surfaces a failed run", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(status({ ...idleProgress, phase: "error", error: "boom", total: 120, processed: 4 })),
    );

    render(<AdminRecommendations />);
    expect(await screen.findByText("Ошибка")).toBeInTheDocument();
    expect(screen.getByText("Ошибка: boom")).toBeInTheDocument();
  });
});
