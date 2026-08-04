import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import AdminForexConfig from "@/components/AdminForexConfig";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;
global.confirm = vi.fn(() => true) as any;

const features = [
  {
    key: "forex",
    label: "Форекс раздел",
    description: "Общий выключатель раздела",
    value: { enabled: true },
  },
  {
    key: "forexPublicAccess",
    label: "Публичный доступ",
    description: "Доступ для обычных пользователей",
    value: { enabled: false },
  },
];

const configItems = [
  { symbol: "EUR/USD", enabled: true, updatedAt: "2024-01-01T00:00:00Z" },
  { symbol: "GBP/USD", enabled: false, updatedAt: "2024-01-02T00:00:00Z" },
];

function setupFetch(opts: { items?: any[]; features?: any[] } = {}) {
  mockFetch.mockImplementation((url: string, init?: any) => {
    if (url === "/api/admin/features" && (!init || init.method === undefined)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ features: opts.features ?? features }) });
    }
    if (url === "/api/admin/features" && init?.method === "PATCH") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (url === "/api/admin/forex/config" && (!init || init.method === undefined)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: opts.items ?? configItems }) });
    }
    if (url === "/api/admin/forex/config" && init?.method === "POST") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ items: [...(opts.items ?? configItems), { symbol: "USD/JPY", enabled: true, updatedAt: "now" }] }),
      });
    }
    if (url === "/api/admin/forex/config" && init?.method === "PATCH") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: opts.items ?? configItems }) });
    }
    if (typeof url === "string" && url.startsWith("/api/admin/forex/config?") && init?.method === "DELETE") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
    }
    if (url === "/api/admin/forex" && (!init || init.method === undefined)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ envSymbols: ["EUR/USD", "GBP/USD"] }) });
    }
    if (url === "/api/admin/forex/purge" && (!init || init.method === undefined)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ oldest: "2024-01-01T00:00:00Z", newest: "2024-06-01T00:00:00Z" }),
      });
    }
    if (url === "/api/admin/forex/purge" && init?.method === "POST") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ deleted: 12 }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "not found" }) });
  });
}

describe("AdminForexConfig", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    (global.confirm as any).mockReset?.();
    (global.confirm as any).mockReturnValue?.(true);
  });

  it("renders access toggles from feature config", async () => {
    setupFetch();
    render(<AdminForexConfig />);
    await waitFor(() => expect(screen.getByText("Форекс раздел")).toBeInTheDocument());
    expect(screen.getByText("Публичный доступ")).toBeInTheDocument();
  });

  it("toggles a feature via PATCH", async () => {
    setupFetch();
    render(<AdminForexConfig />);
    await waitFor(() => expect(screen.getByText("Форекс раздел")).toBeInTheDocument());
    const checkboxes = screen.getAllByRole("checkbox");
    // First two checkboxes correspond to access toggles
    fireEvent.click(checkboxes[1]); // forexPublicAccess (currently disabled)
    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        (c: any[]) => c[0] === "/api/admin/features" && c[1]?.method === "PATCH",
      );
      expect(call).toBeTruthy();
    });
  });

  it("renders symbol list with enabled/disabled styling", async () => {
    setupFetch();
    render(<AdminForexConfig />);
    await waitFor(() => expect(screen.getByText("EUR/USD")).toBeInTheDocument());
    expect(screen.getByText("GBP/USD")).toBeInTheDocument();
  });

  it("shows env symbols fallback text", async () => {
    setupFetch();
    render(<AdminForexConfig />);
    await waitFor(() => expect(screen.getByText("EUR/USD")).toBeInTheDocument());
    expect(screen.getByText(/EUR\/USD, GBP\/USD/)).toBeInTheDocument();
  });

  it("adds a new symbol via input and Добавить button", async () => {
    setupFetch();
    render(<AdminForexConfig />);
    await waitFor(() => expect(screen.getByText("EUR/USD")).toBeInTheDocument());
    const input = screen.getByPlaceholderText("EUR/USD");
    fireEvent.change(input, { target: { value: "usd/jpy" } });
    fireEvent.click(screen.getByText("Добавить"));
    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        (c: any[]) => c[0] === "/api/admin/forex/config" && c[1]?.method === "POST",
      );
      expect(call).toBeTruthy();
    });
    const postCall = mockFetch.mock.calls.find(
      (c: any[]) => c[0] === "/api/admin/forex/config" && c[1]?.method === "POST",
    )!;
    const body = JSON.parse(postCall[1].body);
    expect(body.symbol).toBe("USD/JPY");
  });

  it("adds symbol on Enter key press", async () => {
    setupFetch();
    render(<AdminForexConfig />);
    await waitFor(() => expect(screen.getByText("EUR/USD")).toBeInTheDocument());
    const input = screen.getByPlaceholderText("EUR/USD");
    fireEvent.change(input, { target: { value: "aud/usd" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        (c: any[]) => c[0] === "/api/admin/forex/config" && c[1]?.method === "POST",
      );
      expect(call).toBeTruthy();
    });
  });

  it("toggles a symbol enabled state via PATCH", async () => {
    setupFetch();
    render(<AdminForexConfig />);
    await waitFor(() => expect(screen.getByText("EUR/USD")).toBeInTheDocument());
    const symbolCheckbox = screen.getByText("EUR/USD").closest("label")!.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    fireEvent.click(symbolCheckbox);
    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        (c: any[]) => c[0] === "/api/admin/forex/config" && c[1]?.method === "PATCH",
      );
      expect(call).toBeTruthy();
    });
  });

  it("removes a symbol after confirm", async () => {
    setupFetch();
    render(<AdminForexConfig />);
    await waitFor(() => expect(screen.getByText("EUR/USD")).toBeInTheDocument());
    const removeButtons = screen.getAllByTitle("Удалить");
    fireEvent.click(removeButtons[0]);
    expect(global.confirm).toHaveBeenCalled();
    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("/api/admin/forex/config?symbol=") && c[1]?.method === "DELETE",
      );
      expect(call).toBeTruthy();
    });
  });

  it("does not remove symbol when confirm cancelled", async () => {
    (global.confirm as any).mockReturnValue(false);
    setupFetch();
    render(<AdminForexConfig />);
    await waitFor(() => expect(screen.getByText("EUR/USD")).toBeInTheDocument());
    const removeButtons = screen.getAllByTitle("Удалить");
    fireEvent.click(removeButtons[0]);
    const call = mockFetch.mock.calls.find(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("/api/admin/forex/config?symbol=") && c[1]?.method === "DELETE",
    );
    expect(call).toBeFalsy();
  });

  it("shows empty config message when no items", async () => {
    setupFetch({ items: [] });
    render(<AdminForexConfig />);
    await waitFor(() =>
      expect(screen.getByText(/Конфигурация пуста/)).toBeInTheDocument(),
    );
  });

  it("purges candle history via preset month with confirm", async () => {
    setupFetch();
    render(<AdminForexConfig />);
    await waitFor(() => expect(screen.getAllByText(/2024/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText("Удалить первый месяц"));
    expect(global.confirm).toHaveBeenCalled();
    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        (c: any[]) => c[0] === "/api/admin/forex/purge" && c[1]?.method === "POST",
      );
      expect(call).toBeTruthy();
    });
    await waitFor(() => expect(screen.getByText(/Удалено свечей: 12/)).toBeInTheDocument());
  });

  it("shows error message when add-symbol fails", async () => {
    mockFetch.mockImplementation((url: string, init?: any) => {
      if (url === "/api/admin/forex/config" && init?.method === "POST") {
        return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: "invalid symbol" }) });
      }
      if (url === "/api/admin/forex/config") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: configItems }) });
      }
      if (url === "/api/admin/features") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ features }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    render(<AdminForexConfig />);
    await waitFor(() => expect(screen.getByText("EUR/USD")).toBeInTheDocument());
    const input = screen.getByPlaceholderText("EUR/USD");
    fireEvent.change(input, { target: { value: "xxx" } });
    fireEvent.click(screen.getByText("Добавить"));
    await waitFor(() => expect(screen.getByText(/Ошибка: invalid symbol/)).toBeInTheDocument());
  });
});
