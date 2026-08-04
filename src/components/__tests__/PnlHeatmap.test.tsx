import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import PnlHeatmap from "@/components/PnlHeatmap";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    locale: "en",
    timezone: "UTC",
  }),
}));

function daysAgoIso(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

describe("PnlHeatmap", () => {
  it("renders empty state with no data", () => {
    const { container } = render(<PnlHeatmap daily={[]} />);
    expect(container.textContent).toContain("dash.noData");
  });

  it("renders grid cells for mixed positive/negative/no-trade days", () => {
    const daily = [
      { date: daysAgoIso(10), pnl: 500, trades: 2, winR: 3, lossR: 0 },
      { date: daysAgoIso(9), pnl: -200, trades: 1, winR: 0, lossR: -2 },
      { date: daysAgoIso(8), pnl: 0, trades: 0, winR: 0, lossR: 0 },
      { date: daysAgoIso(0), pnl: 50, trades: 3, winR: 1, lossR: -1 },
    ] as any;
    const { container } = render(<PnlHeatmap daily={daily} />);
    const cells = container.querySelectorAll(".h-3.w-3.rounded-\\[2px\\]");
    expect(cells.length).toBeGreaterThan(0);
  });

  it("shows hover tooltip with formatted pnl and trade count", () => {
    const date = daysAgoIso(0);
    const daily = [{ date, pnl: 1234, trades: 5, winR: 3, lossR: -1 }] as any;
    const { container } = render(<PnlHeatmap daily={daily} />);
    const cells = Array.from(
      container.querySelectorAll("div.h-3.w-3.cursor-pointer"),
    );
    const lastCell = cells[cells.length - 1];
    fireEvent.mouseEnter(lastCell, { clientX: 10, clientY: 20 });
    expect(container.textContent).toContain("1,234");
    fireEvent.mouseLeave(lastCell);
  });

  it("shows negative pnl with loss styling", () => {
    const date = daysAgoIso(0);
    const daily = [{ date, pnl: -300, trades: 2, winR: 0, lossR: -3 }] as any;
    const { container } = render(<PnlHeatmap daily={daily} />);
    const cells = Array.from(
      container.querySelectorAll("div.h-3.w-3.cursor-pointer"),
    );
    fireEvent.mouseEnter(cells[cells.length - 1], { clientX: 5, clientY: 5 });
    expect(container.querySelector(".text-loss")).toBeTruthy();
  });

  it("renders legend labels", () => {
    const daily = [{ date: daysAgoIso(0), pnl: 10, trades: 1, winR: 1, lossR: 0 }] as any;
    const { container } = render(<PnlHeatmap daily={daily} />);
    expect(container.textContent).toContain("trades.win");
    expect(container.textContent).toContain("trades.loss");
  });
});
