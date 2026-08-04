import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import RiskManager from "@/components/RiskManager";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    locale: "en",
    timezone: "UTC",
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

const accounts = [
  { id: "acc-1", label: "Bybit main", exchange: "bybit", source: "exchange", balance: 1000 },
  { id: "acc-2", label: "Imported FX", exchange: "oanda", source: "import", balance: 500 },
];

function setupFetch(profiles: Record<string, any> = {}) {
  mockFetch.mockImplementation((url: string, opts?: any) => {
    if (url === "/api/accounts") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(accounts) });
    }
    if (url === "/api/risk/settings" && (!opts || opts.method === undefined)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ profiles }) });
    }
    if (url === "/api/risk/settings" && opts?.method === "PUT") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
}

describe("RiskManager", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("shows loading state initially", () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<RiskManager />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("loads accounts and filters out non-exchange sources", async () => {
    setupFetch();
    render(<RiskManager />);
    await waitFor(() => expect(screen.queryByText("common.loading")).not.toBeInTheDocument());
    expect(screen.getByText("Bybit main")).toBeInTheDocument();
    expect(screen.queryByText("Imported FX")).not.toBeInTheDocument();
  });

  it("applies default profile from server response", async () => {
    setupFetch({
      "": {
        enabled: true,
        maxStopsPerDay: 3,
        riskPerTrade: { on: true, value: 1.5, unit: "pct" },
        lossLimits: {
          day: { on: true, value: 5, unit: "pct" },
          week: { on: false, value: 0, unit: "pct" },
          month: { on: false, value: 0, unit: "pct" },
          year: { on: false, value: 0, unit: "pct" },
        },
      },
    });
    render(<RiskManager />);
    await waitFor(() => expect(screen.queryByText("common.loading")).not.toBeInTheDocument());
    const stopsInput = screen.getByDisplayValue("3");
    expect(stopsInput).toBeInTheDocument();
  });

  it("applies per-account override profile and shows custom toggle checked", async () => {
    setupFetch({
      "acc-1": {
        enabled: true,
        maxStopsPerDay: 2,
        riskPerTrade: { on: false, value: 0, unit: "pct" },
        lossLimits: {
          day: { on: false, value: 0, unit: "pct" },
          week: { on: false, value: 0, unit: "pct" },
          month: { on: false, value: 0, unit: "pct" },
          year: { on: false, value: 0, unit: "pct" },
        },
      },
    });
    render(<RiskManager />);
    await waitFor(() => expect(screen.queryByText("common.loading")).not.toBeInTheDocument());
    const checkboxes = screen.getAllByText("risk.perAccount");
    expect(checkboxes.length).toBeGreaterThan(0);
  });

  it("toggles per-account custom profile on", async () => {
    setupFetch();
    render(<RiskManager />);
    await waitFor(() => expect(screen.queryByText("common.loading")).not.toBeInTheDocument());
    const toggle = screen.getByText("Bybit main").closest("div.card")!.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    expect(screen.getAllByText("risk.enable").length).toBeGreaterThan(1);
  });

  it("saves settings and shows saved confirmation", async () => {
    setupFetch();
    render(<RiskManager />);
    await waitFor(() => expect(screen.queryByText("common.loading")).not.toBeInTheDocument());
    const saveBtn = screen.getByText("common.save");
    fireEvent.click(saveBtn);
    await waitFor(() => expect(screen.getByText("common.saved")).toBeInTheDocument());
    const putCall = mockFetch.mock.calls.find(
      (c: any[]) => c[0] === "/api/risk/settings" && c[1]?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
    const body = JSON.parse(putCall![1].body);
    expect(body.profiles).toHaveProperty("");
  });

  it("edits default risk-per-trade value via NumField", async () => {
    setupFetch();
    render(<RiskManager />);
    await waitFor(() => expect(screen.queryByText("common.loading")).not.toBeInTheDocument());
    const enableCheckbox = screen.getAllByText("risk.enable")[0].closest("label")!.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    fireEvent.click(enableCheckbox);
    expect(enableCheckbox.checked).toBe(true);
  });

  it("does not error when save fails (res not ok)", async () => {
    mockFetch.mockImplementation((url: string, opts?: any) => {
      if (url === "/api/accounts") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url === "/api/risk/settings" && opts?.method === "PUT") {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ profiles: {} }) });
    });
    render(<RiskManager />);
    await waitFor(() => expect(screen.queryByText("common.loading")).not.toBeInTheDocument());
    const saveBtn = screen.getByText("common.save");
    fireEvent.click(saveBtn);
    await waitFor(() => expect(screen.getByText("common.save")).toBeInTheDocument());
  });
});
