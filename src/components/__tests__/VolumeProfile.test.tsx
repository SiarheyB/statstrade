import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import VolumeProfile from "@/components/VolumeProfile";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    timezone: "UTC",
    locale: "en",
  }),
}));

// Mock Recharts ResponsiveContainer to render children directly.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 256 }}>{children}</div>
    ),
  };
});

const mockProfile = {
  poc: 50000,
  vah: 51000,
  val: 49000,
  levels: [
    { price: 48500, volume: 50, isPoc: false, isVa: false, pct: 12.5 },
    { price: 49000, volume: 100, isPoc: false, isVa: true, pct: 25 },
    { price: 49500, volume: 200, isPoc: false, isVa: true, pct: 50 },
    { price: 50000, volume: 400, isPoc: true, isVa: true, pct: 100 },
    { price: 50500, volume: 200, isPoc: false, isVa: true, pct: 50 },
    { price: 51000, volume: 100, isPoc: false, isVa: true, pct: 25 },
    { price: 51500, volume: 30, isPoc: false, isVa: false, pct: 7.5 },
  ],
  totalVolume: 1080,
  pocVolume: 400,
  valueAreaVolume: 800,
  valueAreaPct: 0.7,
  binSize: 100,
};

describe("VolumeProfile", () => {
  it("renders loading state", () => {
    const { container } = render(<VolumeProfile data={null} loading={true} error={null} />);
    expect(container.textContent).toContain("common.loading");
  });

  it("renders error state", () => {
    const { container } = render(<VolumeProfile data={null} loading={false} error="Test error" />);
    expect(container.textContent).toContain("Test error");
  });

  it("renders empty state when data is null", () => {
    const { container } = render(<VolumeProfile data={null} loading={false} error={null} />);
    expect(container.textContent).toContain("of.noVolumeProfile");
  });

  it("renders empty state when levels are empty", () => {
    const emptyProfile = { ...mockProfile, levels: [] };
    const { container } = render(<VolumeProfile data={emptyProfile} loading={false} error={null} />);
    expect(container.textContent).toContain("of.noVolumeProfile");
  });

  it("renders chart with data", () => {
    const { container } = render(<VolumeProfile data={mockProfile} loading={false} error={null} />);
    expect(container.textContent).toContain("of.volumeProfile");
    expect(container.textContent).toContain("50,000"); // POC price (formatted)
    expect(container.textContent).toContain("51,000"); // VAH
    expect(container.textContent).toContain("49,000"); // VAL
  });

  it("renders POC marker", () => {
    const { container } = render(<VolumeProfile data={mockProfile} loading={false} error={null} />);
    // POC should be labeled
    expect(container.textContent).toContain("POC");
  });

  it("renders VAH and VAL labels", () => {
    const { container } = render(<VolumeProfile data={mockProfile} loading={false} error={null} />);
    expect(container.textContent).toContain("VAH");
    expect(container.textContent).toContain("VAL");
  });

  it("renders legend", () => {
    const { container } = render(<VolumeProfile data={mockProfile} loading={false} error={null} />);
    expect(container.textContent).toContain("HVN");
    expect(container.textContent).toContain("LVN");
  });

  it("displays total volume", () => {
    const { container } = render(<VolumeProfile data={mockProfile} loading={false} error={null} />);
    expect(container.textContent).toContain("1.08K"); // 1080 formatted
  });

  it("shows Value Area percentage in legend", () => {
    const { container } = render(<VolumeProfile data={mockProfile} loading={false} error={null} />);
    expect(container.textContent).toContain("70");
  });
});