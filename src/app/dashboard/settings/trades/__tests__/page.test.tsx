import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TradeSettingsPage from "../page";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    locale: "ru",
    timezone: "auto",
    setLocale: vi.fn(),
    setTimezone: vi.fn(),
  }),
}));

const initialSettings = {
  entryPointOptions: ["Support", "Resistance"],
  entryTypeOptions: ["Breakout"],
  mistakeOptions: ["FOMO"],
  patternOptions: ["Flag"],
};

function mockFetchGetOk(data = initialSettings) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TradeSettingsPage", () => {
  it("renders loading state initially", () => {
    mockFetchGetOk();
    render(<TradeSettingsPage />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("renders lists after load", async () => {
    mockFetchGetOk();
    render(<TradeSettingsPage />);
    expect(await screen.findByText("Support")).toBeInTheDocument();
    expect(screen.getByText("Resistance")).toBeInTheDocument();
    expect(screen.getByText("Breakout")).toBeInTheDocument();
    expect(screen.getByText("FOMO")).toBeInTheDocument();
    expect(screen.getByText("Flag")).toBeInTheDocument();
  });

  it("adds a new item to a list", async () => {
    mockFetchGetOk();
    render(<TradeSettingsPage />);
    await screen.findByText("Support");

    const inputs = screen.getAllByPlaceholderText("settings.addValue");
    // Patterns section is first
    fireEvent.change(inputs[0], { target: { value: "New Pattern" } });
    fireEvent.keyDown(inputs[0], { key: "Enter" });

    expect(await screen.findByText("New Pattern")).toBeInTheDocument();
  });

  it("removes an item from a list", async () => {
    mockFetchGetOk();
    render(<TradeSettingsPage />);
    await screen.findByText("Support");

    const supportPill = screen.getByText("Support").closest("span")!;
    const removeBtn = supportPill.querySelector("button")!;
    fireEvent.click(removeBtn);

    await waitFor(() => expect(screen.queryByText("Support")).not.toBeInTheDocument());
  });

  it("saves successfully and shows saved state", async () => {
    mockFetchGetOk();
    render(<TradeSettingsPage />);
    await screen.findByText("Support");

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(initialSettings),
    });

    fireEvent.click(screen.getByText("common.save"));

    expect(await screen.findByText("common.saved")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("shows error message when save fails", async () => {
    mockFetchGetOk();
    render(<TradeSettingsPage />);
    await screen.findByText("Support");

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Save failed" }),
    });

    fireEvent.click(screen.getByText("common.save"));

    expect(await screen.findByText("Save failed")).toBeInTheDocument();
  });
});
