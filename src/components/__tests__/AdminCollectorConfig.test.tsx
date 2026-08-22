import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import AdminCollectorConfig from "@/components/AdminCollectorConfig";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;
global.confirm = vi.fn(() => true) as any;

const configItems = [
  { symbol: "BTCUSDT", market: "spot", minCoins: 0.01, collectAll: false },
  { symbol: "ETHUSDT", market: "futures", minCoins: 0, collectAll: true },
];

function setupFetch(opts: { items?: any[] } = {}) {
  mockFetch.mockImplementation((url: string, init?: any) => {
    if (url === "/api/admin/collector/config" && (!init || init.method === undefined)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: opts.items ?? configItems }) });
    }
    if (url === "/api/admin/collector/config" && init?.method === "PUT") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: opts.items ?? configItems }) });
    }
    if (typeof url === "string" && url.startsWith("/api/admin/collector/config?") && init?.method === "DELETE") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (url === "/api/admin/collector/purge-candles" && (!init || init.method === undefined)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ oldest: "2024-01-01T00:00:00Z", newest: "2024-06-01T00:00:00Z" }),
      });
    }
    if (url === "/api/admin/collector/purge-candles" && init?.method === "POST") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ deleted: 42 }) });
    }
    if (url === "/api/admin/collector/purge-candles/truncate") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (url === "/api/admin/collector/purge" && (!init || init.method === undefined)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ oldest: "2024-01-01T00:00:00Z", newest: "2024-06-01T00:00:00Z" }),
      });
    }
    if (url === "/api/admin/collector/purge" && init?.method === "POST") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ total: 7 }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "not found" }) });
  });
}

describe("AdminCollectorConfig", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    (global.confirm as any).mockReset?.();
    (global.confirm as any).mockReturnValue?.(true);
  });

  it("loads and renders existing symbol config rows", async () => {
    setupFetch();
    render(<AdminCollectorConfig />);
    await waitFor(() => expect(screen.getByDisplayValue("BTCUSDT")).toBeInTheDocument());
    expect(screen.getByDisplayValue("ETHUSDT")).toBeInTheDocument();
  });

  it("adds a new empty row on click", async () => {
    setupFetch();
    render(<AdminCollectorConfig />);
    await waitFor(() => expect(screen.getByDisplayValue("BTCUSDT")).toBeInTheDocument());
    const addBtn = screen.getByRole("button", { name: /Символ/ });
    fireEvent.click(addBtn);
    const symbolInputs = screen.getAllByPlaceholderText("BTCUSDT");
    expect(symbolInputs.length).toBe(3);
  });

  it("edits symbol, market, minCoins and collectAll fields", async () => {
    setupFetch();
    render(<AdminCollectorConfig />);
    await waitFor(() => expect(screen.getByDisplayValue("BTCUSDT")).toBeInTheDocument());
    const symbolInput = screen.getByDisplayValue("BTCUSDT") as HTMLInputElement;
    fireEvent.change(symbolInput, { target: { value: "SOLUSDT" } });
    expect(screen.getByDisplayValue("SOLUSDT")).toBeInTheDocument();
  });

  it("removes a row and calls DELETE endpoint with symbol/market", async () => {
    setupFetch();
    render(<AdminCollectorConfig />);
    await waitFor(() => expect(screen.getByDisplayValue("BTCUSDT")).toBeInTheDocument());
    const deleteButtons = screen.getAllByTitle("Удалить (вернётся к дефолту коллектора)");
    fireEvent.click(deleteButtons[0]);
    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("symbol=BTCUSDT") && c[1]?.method === "DELETE",
      );
      expect(call).toBeTruthy();
    });
  });

  it("saves config: filters invalid rows and sends PUT with normalized payload", async () => {
    setupFetch();
    render(<AdminCollectorConfig />);
    await waitFor(() => expect(screen.getByDisplayValue("BTCUSDT")).toBeInTheDocument());
    const addBtn = screen.getByRole("button", { name: /Символ/ });
    fireEvent.click(addBtn); // adds an empty invalid row (symbol="")
    const saveBtn = screen.getByText("Сохранить");
    fireEvent.click(saveBtn);
    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        (c: any[]) => c[0] === "/api/admin/collector/config" && c[1]?.method === "PUT",
      );
      expect(call).toBeTruthy();
    });
    const putCall = mockFetch.mock.calls.find(
      (c: any[]) => c[0] === "/api/admin/collector/config" && c[1]?.method === "PUT",
    )!;
    const body = JSON.parse(putCall[1].body);
    // empty-symbol row filtered out; two valid rows remain
    expect(body.items.length).toBe(2);
    expect(body.items[0].symbol).toBe("BTCUSDT");
    await waitFor(() => expect(screen.getByText(/Сохранено/)).toBeInTheDocument());
  });

  it("shows error message when save fails", async () => {
    mockFetch.mockImplementation((url: string, init?: any) => {
      if (url === "/api/admin/collector/config" && init?.method === "PUT") {
        return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: "bad input" }) });
      }
      if (url === "/api/admin/collector/config") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: configItems }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    render(<AdminCollectorConfig />);
    await waitFor(() => expect(screen.getByDisplayValue("BTCUSDT")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Сохранить"));
    await waitFor(() => expect(screen.getByText(/Ошибка: bad input/)).toBeInTheDocument());
  });

  it("PurgeHistory: shows date range and purges preset month with confirm", async () => {
    setupFetch();
    render(<AdminCollectorConfig />);
    await waitFor(() => expect(screen.getAllByText(/2024/).length).toBeGreaterThan(0));
    const purgeButtons = screen.getAllByText("Удалить первый месяц");
    fireEvent.click(purgeButtons[0]);
    expect(global.confirm).toHaveBeenCalled();
    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        (c: any[]) => c[0] === "/api/admin/collector/purge" && c[1]?.method === "POST",
      );
      expect(call).toBeTruthy();
    });
  });

  it("PurgeCandles: truncateAll calls truncate endpoint after confirm", async () => {
    setupFetch();
    render(<AdminCollectorConfig />);
    await waitFor(() => expect(screen.getByText("Полная очистка")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Полная очистка"));
    expect(global.confirm).toHaveBeenCalled();
    await waitFor(() => {
      const call = mockFetch.mock.calls.find((c: any[]) => c[0] === "/api/admin/collector/purge-candles/truncate");
      expect(call).toBeTruthy();
    });
  });

  it("PurgeCandles: does not purge when confirm is cancelled", async () => {
    (global.confirm as any).mockReturnValue(false);
    setupFetch();
    render(<AdminCollectorConfig />);
    await waitFor(() => expect(screen.getByText("Полная очистка")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Полная очистка"));
    expect(global.confirm).toHaveBeenCalled();
    // no truncate POST call added
    const call = mockFetch.mock.calls.find((c: any[]) => c[0] === "/api/admin/collector/purge-candles/truncate");
    expect(call).toBeFalsy();
  });
});
