/**
 * Тесты для DrawingEditor — плавающая панель редактирования рисунка.
 * src/components/DrawingEditor.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DrawingEditor from "@/components/DrawingEditor";
import type { DrawingRow } from "@/lib/drawings";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({ "of.color": "Цвет", "of.lineWidth": "Толщина", "of.delete": "Удалить", "common.close": "Закрыть" })[key] ?? key,
    timezone: "UTC",
  }),
}));

function drawing(over: Partial<DrawingRow> = {}): DrawingRow {
  return {
    id: "d1",
    userId: "u1",
    symbol: "BTCUSDT",
    exchange: "binance",
    toolType: "rectangle",
    points: JSON.stringify([{ t: 0, price: 100 }, { t: 1000, price: 50 }]),
    color: "#e6b800",
    lineWidth: 2,
    fillColor: null,
    label: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...over,
  };
}

function setup(over: Partial<React.ComponentProps<typeof DrawingEditor>> = {}) {
  const props = {
    drawing: drawing(),
    apiBase: "/api/orderflow/drawings",
    onPatched: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<DrawingEditor {...props} />);
  return props;
}

describe("DrawingEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true }) as Response));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the current color and width of the drawing", () => {
    setup();
    expect(screen.getByDisplayValue("#e6b800")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2")).toBeInTheDocument();
  });

  it("PUTs the new colour to the page's API and patches it locally", async () => {
    const props = setup();
    fireEvent.change(screen.getByDisplayValue("#e6b800"), { target: { value: "#00ff00" } });
    await waitFor(() => expect(props.onPatched).toHaveBeenCalledWith("d1", { color: "#00ff00" }));
    expect(fetch).toHaveBeenCalledWith(
      "/api/orderflow/drawings?id=d1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ color: "#00ff00" }) }),
    );
  });

  it("uses the apiBase it was given (forex vs orderflow)", async () => {
    setup({ apiBase: "/api/forex/drawings" });
    fireEvent.change(screen.getByDisplayValue("2"), { target: { value: "4" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/forex/drawings?id=d1", expect.anything()));
  });

  it("does not patch locally when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as Response));
    const props = setup();
    fireEvent.change(screen.getByDisplayValue("#e6b800"), { target: { value: "#00ff00" } });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(props.onPatched).not.toHaveBeenCalled();
  });

  it("calls onDelete and onClose from the icon buttons", () => {
    const props = setup();
    fireEvent.click(screen.getByTitle("Удалить"));
    expect(props.onDelete).toHaveBeenCalledWith("d1");
    fireEvent.click(screen.getByTitle("Закрыть"));
    expect(props.onClose).toHaveBeenCalled();
  });
});
