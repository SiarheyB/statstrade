"use strict";

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import RiskBanner from "./RiskBanner";

// Mock the needed modules
vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (key: string) => {
      if (key === "risk.banner.breached") return "🛑 Risk limit reached — stop for today";
      if (key === "risk.banner.warning") return "Close to your risk limit";
      return key.split(".")[1] || key;
    },
  }),
}));

vi.mock("@/lib/format", () => ({
  fmtUsd: (value: number) => `$${value.toFixed(2)}`,
}));

const mockRiskResponse = (accounts: any[]) => {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ accounts }),
    })
  ) as any;
};

describe("RiskBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders breached state when a limit is exceeded", async () => {
    mockRiskResponse([
      {
        accountId: "acc1",
        enabled: true,
        label: "Test Account",
        state: "breached",
        limits: [
          { key: "stops", unit: "count", used: 3, limit: 3, pct: 1, state: "breached" },
        ],
      },
    ]);

    render(<RiskBanner accountId="acc1" />);
    await screen.findByText("🛑 Risk limit reached — stop for today");
    expect(screen.getByText("Test Account")).toBeTruthy();
    expect(screen.getByText(/Stops 3\/3/)).toBeTruthy();
  });

  it("does NOT display limits where used === 0", async () => {
    mockRiskResponse([
      {
        accountId: "acc1",
        enabled: true,
        label: "Test Account",
        state: "ok",
        limits: [
          { key: "stops", unit: "count", used: 0, limit: 3, pct: 0, state: "ok" },
          { key: "day", unit: "amount", used: 0, limit: 500, pct: 0, state: "ok" },
          { key: "week", unit: "amount", used: 0, limit: 1000, pct: 0, state: "ok" },
        ],
      },
    ]);

    const { container } = render(<RiskBanner accountId="acc1" />);
    // When all used === 0, the banner should show "ok" state but no limit details
    // Because filter removes used=0, we expect no text like "Stops 0/3"
    await screen.findByText("Test Account");

    const text = container.textContent || "";
    expect(text).not.toMatch(/Stops 0/);
    expect(text).not.toMatch(/Day \$0/);
    expect(text).not.toMatch(/Week \$0/);
  });

  it("hides banner entirely when no relevant accounts", async () => {
    mockRiskResponse([]);
    const { container } = render(<RiskBanner accountId="acc1" />);
    // Wait for effect
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".rounded-xl")).toBeNull();
  });

  it("shows warning state with used > 0", async () => {
    mockRiskResponse([
      {
        accountId: "acc1",
        enabled: true,
        label: "Test Account",
        state: "warning",
        limits: [
          { key: "day", unit: "amount", used: 400, limit: 500, pct: 0.8, state: "warning" },
        ],
      },
    ]);

    render(<RiskBanner accountId="acc1" />);
    await screen.findByText("Close to your risk limit");
    expect(screen.getByText(/Day/)).toBeTruthy();
    expect(screen.getByText(/\$400/)).toBeTruthy();
  });

  it("dismiss button hides banner", async () => {
    mockRiskResponse([
      {
        accountId: "acc1",
        enabled: true,
        label: "Test Account",
        state: "breached",
        limits: [
          { key: "stops", unit: "count", used: 3, limit: 3, pct: 1, state: "breached" },
        ],
      },
    ]);

    render(<RiskBanner accountId="acc1" />);
    await screen.findByText("🛑 Risk limit reached — stop for today");

    const closeButton = screen.getByLabelText("close");
    fireEvent.click(closeButton);

    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("🛑 Risk limit reached — stop for today")).toBeNull();
  });
});