/**
 * Тесты для ImbalanceHeatmap — компонент дисбаланса bid/ask.
 * src/components/ImbalanceHeatmap.tsx
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ImbalanceHeatmap from "@/components/ImbalanceHeatmap";
import type { Imbalance } from "@/lib/orderflow";

const mockT = vi.fn((key: string) => {
  const map: Record<string, string> = {
    "common.loading": "Loading…",
    "of.imbalanceTitle": "Bid/Ask Imbalance",
    "of.imbalanceHint": "Imbalance ratio",
    "of.noImbalance": "No imbalance data",
    "of.alerts": "alerts",
  };
  return map[key] ?? key;
});

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: mockT }),
}));

function makeImbalance(overrides: Partial<Imbalance> = {}): Imbalance {
  return {
    times: [1000, 2000, 3000],
    ratio: [-0.5, 0, 0.5],
    fullBid: [0.75, 0.5, 0.25],
    fullAsk: [0.25, 0.5, 0.75],
    nearBid: [0.75, 0.5, 0.25],
    nearAsk: [0.25, 0.5, 0.75],
    alerts: [],
    ...overrides,
  };
}

describe("ImbalanceHeatmap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state", () => {
    render(<ImbalanceHeatmap data={null} loading={true} error={null} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows error state", () => {
    render(<ImbalanceHeatmap data={null} loading={false} error="Error loading" />);
    expect(screen.getByText("Error loading")).toBeTruthy();
  });

  it("shows empty state when no data", () => {
    render(<ImbalanceHeatmap data={null} loading={false} error={null} />);
    expect(screen.getByText("No imbalance data")).toBeTruthy();
  });

  it("renders chart with data", () => {
    const data = makeImbalance();
    render(<ImbalanceHeatmap data={data} loading={false} error={null} />);
    expect(screen.getByText("Bid/Ask Imbalance")).toBeTruthy();
  });

  it("shows alert count when present", () => {
    const data = makeImbalance({
      alerts: [{ t: 1000, type: "high_imbalance", value: 0.8, message: "High imbalance" }],
    });
    render(<ImbalanceHeatmap data={data} loading={false} error={null} />);
    expect(screen.getByText(/1 alerts/)).toBeTruthy();
  });

  it("renders with empty times array", () => {
    const data = makeImbalance({ times: [], ratio: [], fullBid: [], fullAsk: [], nearBid: [], nearAsk: [] });
    render(<ImbalanceHeatmap data={data} loading={false} error={null} />);
    // Должен показать empty state, так как data существует но times.length === 0
    expect(screen.getByText("No imbalance data")).toBeTruthy();
  });

  it("renders alerts with multiple alert types", () => {
    const data = makeImbalance({
      alerts: [
        { t: 1000, type: "high_imbalance", value: 0.8, message: "High ask" },
        { t: 2000, type: "low_imbalance", value: -0.8, message: "High bid" },
        { t: 3000, type: "imbalance_flip", value: 0.1, message: "Flip" },
      ],
    });
    render(<ImbalanceHeatmap data={data} loading={false} error={null} />);
    expect(screen.getByText(/3 alerts/)).toBeTruthy();
  });
});