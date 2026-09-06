import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PositionsPanel from "@/components/game/PositionsPanel";
import { useGameStore } from "@/store/gameStore";
import type { Asset, Position } from "@/engine/entities/types";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "ru", timezone: "auto" }),
}));

const asset: Asset = {
  id: "STK_TEST",
  symbol: "TEST",
  name: "Test Co",
  assetClass: "stock",
  correlationGroup: "tech_stocks",
  baseVolatility: 0.32,
  baseDrift: 0.09,
  tickSize: 0.01,
  tradingHours: "session",
};

function openPosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "p1",
    assetId: asset.id,
    side: "long",
    entryPrice: 100,
    size: 10,
    leverage: 1,
    openedAt: Date.now(),
    fees: 0,
    style: "day",
    ...overrides,
  };
}

function resetStore(positions: Position[]) {
  useGameStore.setState((s) => ({
    ...s,
    game: {
      ...s.game,
      account: { ...s.game.account, balance: 9000, positions },
      prices: { [asset.id]: 110 },
      activeAssets: [asset],
    },
  }));
}

beforeEach(() => resetStore([]));

describe("PositionsPanel", () => {
  it("показывает пустое состояние, когда открытых позиций нет", () => {
    render(<PositionsPanel positions={[]} prices={{ [asset.id]: 110 }} assets={[asset]} />);
    expect(screen.getByText("game.positions.empty")).toBeInTheDocument();
  });

  it("показывает открытую позицию с live unrealized PnL", () => {
    const positions = [openPosition()];
    resetStore(positions);
    render(<PositionsPanel positions={positions} prices={{ [asset.id]: 110 }} assets={[asset]} />);
    expect(screen.getByText("TEST")).toBeInTheDocument();
    // (110-100)*10*1 - 0 fees = 100
    expect(screen.getByText("+100.00 $")).toBeInTheDocument();
  });

  it("показывает множитель плеча рядом со стороной, если leverage > 1", () => {
    const positions = [openPosition({ leverage: 5 })];
    resetStore(positions);
    render(<PositionsPanel positions={positions} prices={{ [asset.id]: 110 }} assets={[asset]} />);
    expect(screen.getByText("×5")).toBeInTheDocument();
  });

  it("не показывает множитель плеча для leverage=1 (без плеча)", () => {
    const positions = [openPosition({ leverage: 1 })];
    resetStore(positions);
    render(<PositionsPanel positions={positions} prices={{ [asset.id]: 110 }} assets={[asset]} />);
    expect(screen.queryByText("×1")).not.toBeInTheDocument();
  });

  it("закрывает позицию по кнопке и убирает её из вкладки «Открытые»", () => {
    const positions = [openPosition()];
    resetStore(positions);
    render(<PositionsPanel positions={positions} prices={{ [asset.id]: 110 }} assets={[asset]} />);
    fireEvent.click(screen.getByText("game.positions.close"));
    const s = useGameStore.getState();
    expect(s.game.account.positions[0].closedAt).toBeDefined();
  });

  it("позволяет выставить стоп-лосс/тейк-профит на уже открытой позиции (SL/TP — редактируемые поля прямо в таблице)", () => {
    const positions = [openPosition()];
    resetStore(positions);
    render(<PositionsPanel positions={positions} prices={{ [asset.id]: 110 }} assets={[asset]} />);
    const [slInput, tpInput] = screen.getAllByPlaceholderText("—");
    fireEvent.change(slInput, { target: { value: "90" } });
    fireEvent.blur(slInput);
    fireEvent.change(tpInput, { target: { value: "130" } });
    fireEvent.blur(tpInput);
    const p = useGameStore.getState().game.account.positions[0];
    expect(p.stopLoss).toBe(90);
    expect(p.takeProfit).toBe(130);
  });

  it("вкладка «История» показывает закрытые сделки, а не открытые", () => {
    const positions = [
      openPosition({ id: "open1" }),
      openPosition({ id: "closed1", closedAt: Date.now(), closePrice: 120, realizedPnl: 199 }),
    ];
    render(<PositionsPanel positions={positions} prices={{ [asset.id]: 110 }} assets={[asset]} />);
    expect(screen.getByText("game.positions.open").parentElement).toHaveTextContent("(1)");
    fireEvent.click(screen.getByText("game.positions.history"));
    expect(screen.getByText("+199.00 $")).toBeInTheDocument();
  });
});
