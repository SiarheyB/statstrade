import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TradesPage from "../page";
import type { SerializedTrade } from "@/lib/types";

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

const mockSyncAll = vi.fn();
let syncState = { anySyncing: false, completedAt: 0 };
vi.mock("@/components/SyncProvider", () => ({
  useSync: () => ({
    anySyncing: syncState.anySyncing,
    completedAt: syncState.completedAt,
    syncAll: mockSyncAll,
  }),
}));

vi.mock("@/components/charts.lazy", () => ({
  TradeChart: () => <div>mocked-trade-chart</div>,
}));
// Ячейка со скриншотом: кнопка «посмотреть» есть только там, где картинка
// реально загружена (как и в настоящем компоненте).
vi.mock("@/components/TradeImageCell", () => ({
  default: ({ imageUrl, onPreview }: { imageUrl: string | null; onPreview: (url: string) => void }) =>
    imageUrl ? (
      <button onClick={() => onPreview(imageUrl)}>смотреть {imageUrl}</button>
    ) : (
      <div>mocked-trade-image-cell</div>
    ),
}));
vi.mock("@/components/ImagePreviewModal", () => ({
  default: ({
    url,
    position,
    onNext,
    onPrev,
  }: {
    url: string;
    position?: { index: number; total: number };
    onNext?: () => void;
    onPrev?: () => void;
  }) => (
    <div data-testid="preview">
      <span data-testid="preview-url">{url}</span>
      <span data-testid="preview-pos">{position ? `${position.index}/${position.total}` : "нет"}</span>
      <button onClick={onPrev}>prev</button>
      <button onClick={onNext}>next</button>
    </div>
  ),
}));

function makeTrade(overrides: Partial<SerializedTrade> = {}): SerializedTrade {
  return {
    id: "t1",
    symbol: "BTCUSDT",
    base: "BTC",
    quote: "USDT",
    market: "spot",
    exchange: "binance",
    accountId: "acc1",
    side: "long",
    entryTime: "2026-07-01T10:00:00.000Z",
    exitTime: "2026-07-01T12:00:00.000Z",
    durationMs: 7200000,
    qty: 1,
    entryPrice: 100,
    exitPrice: 110,
    grossPnl: 10,
    fees: 1,
    netPnl: 9,
    returnPct: 9,
    fillCount: 2,
    result: "win",
    entryPoint: null,
    entryType: null,
    mistake: null,
    pattern: null,
    stopLoss: null,
    note: null,
    imageUrl: null,
    imageProvider: null,
    imagePublicUrl: null,
    ...overrides,
  } as SerializedTrade;
}

// Ответ /api/trades. Страница теперь не получает метрики и словари вместе со
// сделками — они приходят из /api/settings и /api/accounts.
function makeTradesResponse(trades: SerializedTrade[], total = trades.length) {
  return {
    trades,
    total,
    page: 0,
    pageSize: 25,
    symbols: [...new Set(trades.map((t) => t.symbol))],
  };
}

function jsonRes(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

// Мини-«сервер»: отдаёт переданные строки на /api/trades и заглушки на
// сопутствующие эндпоинты. Фильтрация/сортировка теперь на бэкенде, поэтому
// тесты проверяют, что страница ПРОСИТ правильное, а не то, как она режет
// массив у себя.
function installFetch(rowsFor: (params: URLSearchParams) => SerializedTrade[]) {
  const fn = vi.fn((url: string) => {
    const u = String(url);
    if (u.startsWith("/api/trades")) {
      const params = new URLSearchParams(u.split("?")[1] ?? "");
      return jsonRes(makeTradesResponse(rowsFor(params)));
    }
    if (u === "/api/settings") {
      return jsonRes({
        entryPointOptions: [], entryTypeOptions: [], mistakeOptions: [], patternOptions: [],
      });
    }
    if (u === "/api/accounts") {
      return jsonRes([{ id: "acc1", label: "My Account", exchange: "binance", balance: 1000 }]);
    }
    if (u === "/api/risk/settings") return jsonRes({ profiles: {} });
    return jsonRes({ connected: false });
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

// Параметры последнего запроса к /api/trades.
function lastTradesParams(fn: ReturnType<typeof installFetch>): URLSearchParams {
  const calls = fn.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/trades"));
  return new URLSearchParams(calls[calls.length - 1].split("?")[1] ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  syncState = { anySyncing: false, completedAt: 0 };
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:mock");
  } else {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
  }
  installFetch(() => []);
});

describe("TradesPage", () => {
  it("shows loading state initially", () => {
    render(<TradesPage />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("shows empty state when there are no trades", async () => {
    render(<TradesPage />);
    expect(await screen.findByText("trades.empty")).toBeInTheDocument();
  });

  it("renders trades once loaded", async () => {
    installFetch(() => [makeTrade()]);
    render(<TradesPage />);
    expect(await screen.findByText("BTCUSDT")).toBeInTheDocument();
  });

  it("asks the server for the ticker list only on the first load", async () => {
    const fn = installFetch(() => [makeTrade()]);
    render(<TradesPage />);
    await screen.findByText("BTCUSDT");

    const first = new URLSearchParams(
      String(fn.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith("/api/trades"))!.split("?")[1]),
    );
    expect(first.get("withMeta")).toBe("1");

    // Смена фильтра → новый запрос, но словарь тикеров уже есть.
    fireEvent.change(screen.getByDisplayValue("Long + Short"), { target: { value: "long" } });
    await waitFor(() => expect(lastTradesParams(fn).get("side")).toBe("long"));
    expect(lastTradesParams(fn).get("withMeta")).toBeNull();
  });

  it("expands a trade row on click to show detail fields", async () => {
    installFetch(() => [makeTrade()]);
    render(<TradesPage />);
    const row = (await screen.findByText("BTCUSDT")).closest("tr");
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    expect(await screen.findByText("mocked-trade-image-cell")).toBeInTheDocument();
  });

  it("passes the side filter to the server and renders what it returns", async () => {
    const longTrade = makeTrade({ id: "t-long", symbol: "LONGCOIN", side: "long" });
    const shortTrade = makeTrade({ id: "t-short", symbol: "SHORTCOIN", side: "short" });
    const fn = installFetch((params) => {
      const side = params.get("side");
      return side === "all" || !side
        ? [longTrade, shortTrade]
        : [longTrade, shortTrade].filter((t) => t.side === side);
    });

    render(<TradesPage />);
    await screen.findByText("LONGCOIN");
    expect(screen.getByText("SHORTCOIN")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Long + Short"), { target: { value: "long" } });

    await waitFor(() => expect(screen.queryByText("SHORTCOIN")).not.toBeInTheDocument());
    expect(screen.getByText("LONGCOIN")).toBeInTheDocument();
    expect(lastTradesParams(fn).get("side")).toBe("long");
  });

  it("passes sort key and direction to the server", async () => {
    const fn = installFetch(() => [makeTrade({ id: "t1", symbol: "AAA", netPnl: 5 })]);
    render(<TradesPage />);
    await screen.findByText("AAA");

    fireEvent.click(screen.getByText("trades.col.netPnl"));
    await waitFor(() => expect(lastTradesParams(fn).get("sort")).toBe("netPnl"));
    expect(lastTradesParams(fn).get("dir")).toBe("desc");

    fireEvent.click(screen.getByText("trades.col.netPnl"));
    await waitFor(() => expect(lastTradesParams(fn).get("dir")).toBe("asc"));
  });

  it("resets to the first page when a filter changes", async () => {
    const fn = installFetch(() => [makeTrade()]);
    render(<TradesPage />);
    await screen.findByText("BTCUSDT");
    fireEvent.change(screen.getByDisplayValue("Long + Short"), { target: { value: "short" } });
    await waitFor(() => expect(lastTradesParams(fn).get("side")).toBe("short"));
    expect(lastTradesParams(fn).get("page")).toBe("0");
  });

  it("triggers syncAll when clicking the sync button", async () => {
    render(<TradesPage />);
    await screen.findByText("trades.empty");
    fireEvent.click(screen.getByText("trades.syncAll"));
    expect(mockSyncAll).toHaveBeenCalled();
  });

  it("requests the full filtered set (all=1) when exporting to CSV", async () => {
    const fn = installFetch(() => [makeTrade()]);
    render(<TradesPage />);
    await screen.findByText("BTCUSDT");

    fireEvent.click(screen.getByText("trades.csv"));

    await waitFor(() => {
      const exportCall = fn.mock.calls
        .map((c) => String(c[0]))
        .find((u) => u.startsWith("/api/trades") && u.includes("all=1"));
      expect(exportCall).toBeTruthy();
    });
  });

  // Скриншоты листаются прямо в просмотрщике — в пределах открытой страницы
  // таблицы (следующая порция сделок ещё не загружена).
  it("листает скриншоты сделок, не закрывая просмотр", async () => {
    installFetch(() => [
      makeTrade({ id: "t1", symbol: "AAA", imageUrl: "https://img/1" }),
      makeTrade({ id: "t2", symbol: "BBB", imageUrl: null }),
      makeTrade({ id: "t3", symbol: "CCC", imageUrl: "https://img/3" }),
    ]);
    render(<TradesPage />);
    await screen.findByText("AAA");

    // Ячейка со скриншотом живёт в подробностях сделки; раскрыта всегда одна
    // строка — на листание это не влияет, галерея собирается по всей странице.
    fireEvent.click(screen.getByText("AAA"));
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/смотреть https:\/\/img\/1/));
    expect(screen.getByTestId("preview-url")).toHaveTextContent("https://img/1");
    // Сделка без картинки в счёт не идёт.
    expect(screen.getByTestId("preview-pos")).toHaveTextContent("1/2");

    fireEvent.click(screen.getByText("next"));
    expect(screen.getByTestId("preview-url")).toHaveTextContent("https://img/3");
    // По кругу: с последнего снова на первый.
    fireEvent.click(screen.getByText("next"));
    expect(screen.getByTestId("preview-url")).toHaveTextContent("https://img/1");
  });

  it("не показывает стрелки, когда скриншот всего один", async () => {
    installFetch(() => [
      makeTrade({ id: "t1", symbol: "AAA", imageUrl: "https://img/1" }),
      makeTrade({ id: "t2", symbol: "BBB", imageUrl: null }),
    ]);
    render(<TradesPage />);
    await screen.findByText("AAA");

    fireEvent.click(screen.getByText("AAA"));
    fireEvent.click(screen.getByText(/смотреть/));

    expect(screen.getByTestId("preview-pos")).toHaveTextContent("1/1");
  });
});
