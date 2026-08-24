import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DrawingToolbar from "@/components/DrawingToolbar";

function setup(overrides: Partial<React.ComponentProps<typeof DrawingToolbar>> = {}) {
  const props = {
    activeTool: null,
    onSelectTool: vi.fn(),
    magnet: false,
    onToggleMagnet: vi.fn(),
    showDrawings: true,
    onToggleShowDrawings: vi.fn(),
    locked: false,
    onToggleLocked: vi.fn(),
    canUndoMove: false,
    onUndoMove: vi.fn(),
    ...overrides,
  };
  render(<DrawingToolbar {...props} />);
  return props;
}

describe("DrawingToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders tool buttons plus magnet/show/lock/undo controls", () => {
    setup();
    // 4 tool buttons + magnet + show + lock + undo = 8 buttons
    expect(screen.getAllByRole("button")).toHaveLength(8);
  });

  it("calls onSelectTool with the tool type when clicked", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByTitle("Трендовая"));
    expect(props.onSelectTool).toHaveBeenCalledWith("trend_line");
  });

  it("toggles the tool off on second click when already active", async () => {
    const user = userEvent.setup();
    const props = setup({ activeTool: "trend_line" });
    await user.click(screen.getByTitle("Трендовая"));
    expect(props.onSelectTool).toHaveBeenCalledWith(null);
  });

  it("calls onToggleMagnet when the magnet button is clicked", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByTitle("Привязка к свечам (выкл)"));
    expect(props.onToggleMagnet).toHaveBeenCalled();
  });

  it("calls onToggleShowDrawings when the visibility button is clicked", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByTitle("Скрыть рисунки"));
    expect(props.onToggleShowDrawings).toHaveBeenCalled();
  });

  it("calls onToggleLocked when the lock button is clicked", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByTitle("Заблокировать рисунки"));
    expect(props.onToggleLocked).toHaveBeenCalled();
  });

  it("disables the undo button when canUndoMove is false", () => {
    setup({ canUndoMove: false });
    expect(screen.getByTitle("Вернуть рисунок на прежнее место")).toBeDisabled();
  });

  it("calls onUndoMove when enabled and clicked", async () => {
    const user = userEvent.setup();
    const props = setup({ canUndoMove: true });
    const btn = screen.getByTitle("Вернуть рисунок на прежнее место");
    expect(btn).not.toBeDisabled();
    await user.click(btn);
    expect(props.onUndoMove).toHaveBeenCalled();
  });

  it("does not render timeframes when they are not passed (обычный режим)", () => {
    setup();
    expect(screen.queryByTitle("Таймфрейм 1h")).toBeNull();
  });

  it("renders a timeframe button per timeframe and marks the active one", () => {
    setup({ timeframes: ["5m", "1h", "1d"], activeTimeframe: "1h", onSelectTimeframe: vi.fn() });
    // 8 кнопок панели + 3 таймфрейма
    expect(screen.getAllByRole("button")).toHaveLength(11);
    expect(screen.getByTitle("Таймфрейм 1h").className).toContain("text-accent");
    expect(screen.getByTitle("Таймфрейм 5m").className).not.toContain("text-accent");
  });

  it("calls onSelectTimeframe with the clicked timeframe", async () => {
    const user = userEvent.setup();
    const props = setup({ timeframes: ["5m", "1h"], activeTimeframe: "1h", onSelectTimeframe: vi.fn() });
    await user.click(screen.getByTitle("Таймфрейм 5m"));
    expect(props.onSelectTimeframe).toHaveBeenCalledWith("5m");
  });
});
