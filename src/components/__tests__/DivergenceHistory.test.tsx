/**
 * Тесты для DivergenceHistory — таблица сигналов дивергенции.
 * src/components/DivergenceHistory.tsx
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DivergenceHistory from "@/components/DivergenceHistory";
import type { DivergenceSignal } from "@/lib/orderflow";

// Мокаем i18n.
const mockT = vi.fn((key: string) => {
  const map: Record<string, string> = {
    "common.loading": "Loading…",
    "of.divergenceTitle": "Divergence Scanner",
    "of.divergenceHint": "Divergence between price and delta/CVD",
    "of.noDivergence": "No divergences detected",
    "of.regularBearish": "Regular Bearish",
    "of.regularBullish": "Regular Bullish",
    "of.hiddenBearish": "Hidden Bearish",
    "of.hiddenBullish": "Hidden Bullish",
    "of.regularBearishHint": "Price makes HH, delta makes LH",
    "of.regularBullishHint": "Price makes LL, delta makes HL",
    "of.hiddenBearishHint": "Continuation pattern in downtrend",
    "of.hiddenBullishHint": "Continuation pattern in uptrend",
    "of.thTime": "Time",
    "of.thType": "Type",
    "of.thStrength": "Str",
    "of.thPrice": "Price",
    "of.thDelta": "Δ",
    "of.thBars": "Bars",
    "of.thStatus": "Status",
    "of.confirmed": "Confirmed",
    "of.pending": "Pending",
  };
  return map[key] ?? key;
});

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: mockT, timezone: "UTC" }),
}));

function makeSignal(overrides: Partial<DivergenceSignal>): DivergenceSignal {
  return {
    id: "s1",
    type: "regular_bearish",
    strength: 3,
    t: 1000000000000,
    pricePeak: 50000,
    priceTrough: 49000,
    deltaPeak: 100,
    deltaTrough: -50,
    bars: 5,
    confirmed: false,
    label: "Regular Bearish",
    ...overrides,
  };
}

describe("DivergenceHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state", () => {
    render(<DivergenceHistory signals={[]} loading={true} error={null} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows error state", () => {
    render(<DivergenceHistory signals={[]} loading={false} error="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });

  it("shows empty state when no signals", () => {
    render(<DivergenceHistory signals={[]} loading={false} error={null} />);
    expect(screen.getByText("No divergences detected")).toBeTruthy();
  });

  it("renders a signal row", () => {
    const sigs = [makeSignal({})];
    render(<DivergenceHistory signals={sigs} loading={false} error={null} />);
    // Проверяем, что тип сигнала отображается (текст может быть разбит по элементам).
    expect(screen.getByText((c) => c.includes("Regular Bearish"))).toBeTruthy();
    // Проверяем, что сила отображается.
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("shows confirmed status", () => {
    const sigs = [makeSignal({ confirmed: true })];
    render(<DivergenceHistory signals={sigs} loading={false} error={null} />);
    expect(screen.getByText("Confirmed")).toBeTruthy();
  });

  it("shows pending status", () => {
    const sigs = [makeSignal({ confirmed: false })];
    render(<DivergenceHistory signals={sigs} loading={false} error={null} />);
    expect(screen.getByText("Pending")).toBeTruthy();
  });

  it("renders multiple signals", () => {
    const sigs = [
      makeSignal({ id: "s1", type: "regular_bearish", strength: 3, label: "Regular Bearish" }),
      makeSignal({ id: "s2", type: "regular_bullish", strength: 4, label: "Regular Bullish" }),
    ];
    render(<DivergenceHistory signals={sigs} loading={false} error={null} />);
    expect(screen.getByText((c) => c.includes("Regular Bearish"))).toBeTruthy();
    expect(screen.getByText((c) => c.includes("Regular Bullish"))).toBeTruthy();
  });

  it("sorts by strength descending by default", () => {
    const sigs = [
      makeSignal({ id: "s1", strength: 2 }),
      makeSignal({ id: "s2", strength: 5 }),
    ];
    render(<DivergenceHistory signals={sigs} loading={false} error={null} />);
    // Strength 5 должен быть перед Strength 2 — ищем в порядке DOM.
    const rows = screen.getAllByRole("row");
    // row 0 = header, row 1 = first data row, row 2 = second data row.
    expect(rows[1].textContent).toContain("5");
    expect(rows[2].textContent).toContain("2");
  });

  it("toggles sort direction on header click", () => {
    const sigs = [
      makeSignal({ id: "s1", strength: 2 }),
      makeSignal({ id: "s2", strength: 5 }),
    ];
    render(<DivergenceHistory signals={sigs} loading={false} error={null} />);
    // Кликаем на заголовок Str для сортировки по возрастанию.
    const strHeader = screen.getByText("Str");
    fireEvent.click(strHeader);
    // Теперь слабый (2) должен быть первым.
    const rows = screen.getAllByRole("row");
    expect(rows[1].textContent).toContain("2");
    expect(rows[2].textContent).toContain("5");
  });
});