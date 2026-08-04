import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PlaybooksPage from "../page";

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

function mockFetchImpl({
  featureEnabled = true,
  maxPerUser = 20,
  playbooks = [] as { id: string; name: string; rules: string; updatedAt: string }[],
  byPattern = [] as { label: string; trades: number; winRate: number; netPnl: number }[],
} = {}) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/features")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ value: { enabled: featureEnabled, maxPerUser } }),
      });
    }
    if (url.startsWith("/api/playbooks")) {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              playbook: { id: `pb:${body.name}`, name: body.name, rules: body.rules, updatedAt: new Date().toISOString() },
            }),
        });
      }
      if (init?.method === "DELETE") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ playbooks }) });
    }
    if (url.startsWith("/api/stats")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ metrics: { byPattern } }),
      });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  }) as any;
}

describe("PlaybooksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn(() => true);
    window.alert = vi.fn();
  });

  it("shows loading state initially", () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any;
    render(<PlaybooksPage />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("renders nothing when feature is disabled", async () => {
    global.fetch = mockFetchImpl({ featureEnabled: false });
    const { container } = render(<PlaybooksPage />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("renders empty state when there are no playbooks", async () => {
    global.fetch = mockFetchImpl({ playbooks: [] });
    render(<PlaybooksPage />);
    await waitFor(() => expect(screen.getByText("playbooks.empty")).toBeInTheDocument());
  });

  it("renders playbooks with stats and allows editing + saving rules", async () => {
    global.fetch = mockFetchImpl({
      playbooks: [{ id: "pb1", name: "Breakout", rules: "Wait for volume", updatedAt: new Date().toISOString() }],
      byPattern: [{ label: "Breakout", trades: 5, winRate: 60, netPnl: 120 }],
    });

    render(<PlaybooksPage />);
    await waitFor(() => expect(screen.getByText("Breakout")).toBeInTheDocument());

    expect(screen.getByDisplayValue("Wait for volume")).toBeInTheDocument();
    expect(screen.getByText("+120.00 $")).toBeInTheDocument();

    const textarea = screen.getByDisplayValue("Wait for volume");
    fireEvent.change(textarea, { target: { value: "Updated rules" } });
    fireEvent.click(screen.getByText("playbooks.save"));

    await waitFor(() => {
      const calls = (global.fetch as any).mock.calls.filter((c: any[]) => c[1]?.method === "PUT");
      expect(calls.length).toBe(1);
    });
  });

  it("shows noTrades hint for playbooks without matching stats", async () => {
    global.fetch = mockFetchImpl({
      playbooks: [{ id: "pb1", name: "Reversal", rules: "", updatedAt: new Date().toISOString() }],
      byPattern: [],
    });
    render(<PlaybooksPage />);
    await waitFor(() => expect(screen.getByText("Reversal")).toBeInTheDocument());
    expect(screen.getByText("playbooks.noTrades")).toBeInTheDocument();
  });

  it("adds a new playbook via the input and delete removes it", async () => {
    global.fetch = mockFetchImpl({ playbooks: [] });
    render(<PlaybooksPage />);
    await waitFor(() => expect(screen.getByText("playbooks.empty")).toBeInTheDocument());

    const input = screen.getByPlaceholderText("playbooks.newPlaceholder");
    fireEvent.change(input, { target: { value: "Scalping" } });
    fireEvent.click(screen.getByText("playbooks.add"));

    expect(await screen.findByText("Scalping")).toBeInTheDocument();

    fireEvent.click(screen.getByText("playbooks.delete"));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Scalping")).not.toBeInTheDocument());
  });
});
