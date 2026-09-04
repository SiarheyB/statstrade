import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OrderTicket from "@/components/game/OrderTicket";
import { useGameStore } from "@/store/gameStore";
import type { Asset } from "@/engine/entities/types";

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

function resetStore(balance = 10_000) {
  useGameStore.setState((s) => ({
    ...s,
    game: {
      ...s.game,
      account: { ...s.game.account, balance, positions: [] },
      prices: { [asset.id]: 100 },
      activeAssets: [asset],
    },
  }));
}

beforeEach(() => resetStore());

function renderTicket(overrides: Partial<Parameters<typeof OrderTicket>[0]> = {}) {
  return render(
    <OrderTicket
      assets={[asset]}
      selectedAssetId={asset.id}
      onSelectAsset={() => {}}
      prices={{ [asset.id]: 100 }}
      balance={10_000}
      maxLeverage={1}
      {...overrides}
    />,
  );
}

describe("OrderTicket", () => {
  it("показывает текущую цену выбранного актива", () => {
    renderTicket();
    expect(screen.getByText(/100/)).toBeInTheDocument();
  });

  it("открывает long-позицию по кнопке Buy и обновляет баланс в сторе", () => {
    renderTicket();
    fireEvent.change(screen.getByTestId("order-ticket").querySelector('input[type="number"]')!, {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByTestId("buy-button"));
    const s = useGameStore.getState();
    expect(s.game.account.positions).toHaveLength(1);
    expect(s.game.account.positions[0].side).toBe("long");
    expect(s.game.account.balance).toBe(10_000 - 10 * 100);
  });

  it("открывает short-позицию по кнопке Sell", () => {
    renderTicket();
    fireEvent.click(screen.getByTestId("sell-button"));
    const s = useGameStore.getState();
    expect(s.game.account.positions).toHaveLength(1);
    expect(s.game.account.positions[0].side).toBe("short");
  });

  it("блокирует кнопки Buy/Sell, когда стоимости не хватает на балансе (edge case раздела 26)", () => {
    resetStore(50); // хватит меньше чем на 1 акцию по 100 при размере по умолчанию (10)
    renderTicket({ balance: 50 });
    expect(screen.getByTestId("buy-button")).toBeDisabled();
    expect(screen.getByTestId("sell-button")).toBeDisabled();
    fireEvent.click(screen.getByTestId("buy-button"));
    expect(useGameStore.getState().game.account.positions).toHaveLength(0);
  });

  it("передаёт stopLoss/takeProfit в открытую позицию", () => {
    renderTicket();
    const [, slInput, tpInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(slInput, { target: { value: "90" } });
    fireEvent.change(tpInput, { target: { value: "120" } });
    fireEvent.click(screen.getByTestId("buy-button"));
    const p = useGameStore.getState().game.account.positions[0];
    expect(p.stopLoss).toBe(90);
    expect(p.takeProfit).toBe(120);
  });

  it("без плеча в стиле (maxLeverage=1) не показывает слайдер плеча", () => {
    renderTicket({ maxLeverage: 1 });
    expect(screen.queryByText("game.order.leverage")).not.toBeInTheDocument();
  });

  it("с плечом в стиле — открывает позицию с выбранным плечом, резервируя requiredMargin", () => {
    renderTicket({ maxLeverage: 10 });
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("buy-button"));
    const p = useGameStore.getState().game.account.positions[0];
    expect(p.leverage).toBe(5);
    // requiredMargin = 100*10/5 = 200, а не 1000.
    expect(useGameStore.getState().game.account.balance).toBe(10_000 - 200);
  });

  it("показывает цены ликвидации long/short, когда плечо больше 1", () => {
    renderTicket({ maxLeverage: 10 });
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "5" } });
    expect(screen.getByText("game.order.liqLong")).toBeInTheDocument();
    expect(screen.getByText("game.order.liqShort")).toBeInTheDocument();
  });

  it("не показывает подсказку по размеру позиции, пока стоп-лосс не заполнен", () => {
    renderTicket();
    expect(screen.queryByText("game.order.suggestedSize")).not.toBeInTheDocument();
  });

  it("показывает рекомендуемый размер позиции после заполнения стоп-лосса", () => {
    renderTicket();
    const [, slInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(slInput, { target: { value: "95" } });
    expect(screen.getByText("game.order.suggestedSize")).toBeInTheDocument();
  });
});
