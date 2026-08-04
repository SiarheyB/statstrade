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

type MockPlaybook = { id: string; name: string; entryPoint?: string; rules: string; updatedAt: string };
type MockTrade = { pattern: string | null; entryPoint: string | null; result: "win" | "loss" | "breakeven"; netPnl: number };

function mockFetchImpl({
  featureEnabled = true,
  maxPerUser = 20,
  playbooks = [] as MockPlaybook[],
  trades = [] as MockTrade[],
  entryPointOptions = [] as string[],
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
              playbook: {
                id: `pb:${body.name}:${body.entryPoint ?? ""}`,
                name: body.name,
                entryPoint: body.entryPoint ?? "",
                rules: body.rules,
                updatedAt: new Date().toISOString(),
              },
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
        json: () => Promise.resolve({ trades, entryPointOptions, metrics: {} }),
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

  it("renders playbooks with stats computed from matching trades, and allows editing + saving rules", async () => {
    global.fetch = mockFetchImpl({
      playbooks: [{ id: "pb1", name: "Breakout", rules: "Wait for volume", updatedAt: new Date().toISOString() }],
      trades: [
        { pattern: "Breakout", entryPoint: "Retest", result: "win", netPnl: 100 }, // has entry point — belongs to its own playbook, must not count here
        { pattern: "Breakout", entryPoint: "Impulse", result: "win", netPnl: 40 }, // ditto
        { pattern: "Breakout", entryPoint: null, result: "loss", netPnl: -20 }, // no entry point — this is the one that counts
        { pattern: "Reversal", entryPoint: null, result: "win", netPnl: 999 }, // different pattern — must not count
      ],
    });

    render(<PlaybooksPage />);
    await waitFor(() => expect(screen.getByText("Breakout")).toBeInTheDocument());

    expect(screen.getByDisplayValue("Wait for volume")).toBeInTheDocument();
    // No-entry-point playbook counts ONLY the trade with no entry point tagged: -20, not 120.
    expect(screen.getByText("-20.00 $")).toBeInTheDocument();

    const textarea = screen.getByDisplayValue("Wait for volume");
    fireEvent.change(textarea, { target: { value: "Updated rules" } });
    fireEvent.click(screen.getByText("playbooks.save"));

    await waitFor(() => {
      const calls = (global.fetch as any).mock.calls.filter((c: any[]) => c[1]?.method === "PUT");
      expect(calls.length).toBe(1);
    });
  });

  it("scopes stats to the matching entry point when the playbook narrows to one ТВХ", async () => {
    global.fetch = mockFetchImpl({
      playbooks: [{ id: "pb1", name: "Breakout", entryPoint: "Retest", rules: "", updatedAt: new Date().toISOString() }],
      trades: [
        { pattern: "Breakout", entryPoint: "Retest", result: "win", netPnl: 100 },
        { pattern: "Breakout", entryPoint: "Impulse", result: "win", netPnl: 40 }, // different ТВХ — must not count
      ],
    });

    render(<PlaybooksPage />);
    await waitFor(() => expect(screen.getByText("Breakout")).toBeInTheDocument());
    // Only the "Retest" trade counts: netPnl = 100, not 140.
    expect(screen.getByText("+100.00 $")).toBeInTheDocument();
  });

  it("keeps the no-entry-point and specific-entry-point playbooks for the same pattern mutually exclusive (no double counting)", async () => {
    global.fetch = mockFetchImpl({
      playbooks: [
        { id: "pb1", name: "Breakout", rules: "", updatedAt: new Date().toISOString() },
        { id: "pb2", name: "Breakout", entryPoint: "Retest", rules: "", updatedAt: new Date().toISOString() },
      ],
      trades: [
        { pattern: "Breakout", entryPoint: "Retest", result: "win", netPnl: 100 },
        { pattern: "Breakout", entryPoint: null, result: "win", netPnl: 30 },
      ],
    });

    render(<PlaybooksPage />);
    await waitFor(() => expect(screen.getAllByText("Breakout").length).toBe(2));

    // No-entry-point card: only the untagged trade (30). Specific-entry-point card: only its trade (100).
    // Neither total (120) nor the "Retest" trade should appear in the no-entry-point card.
    expect(screen.getByText("+30.00 $")).toBeInTheDocument();
    expect(screen.getByText("+100.00 $")).toBeInTheDocument();
    expect(screen.queryByText("+120.00 $")).not.toBeInTheDocument();
  });

  it("shows noTrades hint for playbooks without matching stats", async () => {
    global.fetch = mockFetchImpl({
      playbooks: [{ id: "pb1", name: "Reversal", rules: "", updatedAt: new Date().toISOString() }],
      trades: [],
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

  it("adds a new playbook scoped to a chosen entry point", async () => {
    global.fetch = mockFetchImpl({ playbooks: [], entryPointOptions: ["Retest", "Impulse"] });
    render(<PlaybooksPage />);
    await waitFor(() => expect(screen.getByText("playbooks.empty")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("playbooks.newPlaceholder"), { target: { value: "Breakout" } });
    const select = screen.getByTitle("playbooks.entryPointHint");
    fireEvent.change(select, { target: { value: "Retest" } });
    fireEvent.click(screen.getByText("playbooks.add"));

    expect(await screen.findByText("Breakout")).toBeInTheDocument();
    expect(screen.getByText('playbooks.entryPointBadge:{"entryPoint":"Retest"}')).toBeInTheDocument();
  });
});
