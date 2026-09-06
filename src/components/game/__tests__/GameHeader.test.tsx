import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import GameHeader from "@/components/game/GameHeader";
import { useGameStore } from "@/store/gameStore";
import type { GameState } from "@/engine/gameLoop";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "ru", timezone: "auto" }),
}));

/** Состояние берём из стора: собрать GameState руками — сорок полей. */
function stateWith(patch: { equity?: number; balance?: number; dayStart?: number }): GameState {
  const base = useGameStore.getState().game;
  return {
    ...base,
    dayStartEquity: patch.dayStart ?? patch.equity ?? base.account.equity,
    account: {
      ...base.account,
      equity: patch.equity ?? base.account.equity,
      balance: patch.balance ?? base.account.balance,
      positions: [],
    },
  };
}

/** Класс цвета у цифры: ищем по её тексту. */
function toneOf(text: string): string {
  const node = screen.getAllByText(text).find((el) => el.className.includes("text-lg"));
  return node?.className ?? "";
}

describe("цвет цифр в шапке", () => {
  it("отрицательная эквити красная, даже если день закончился в плюс", () => {
    // Раньше цвет брался ТОЛЬКО из дневного результата: счёт ушёл в минус, а
    // цифра оставалась зелёной, потому что за день было плюс.
    render(
      <GameHeader
        game={stateWith({ equity: -500, balance: -500, dayStart: -800 })}
        styleLabel="day"
        playerName="Тест"
      />,
    );
    expect(toneOf("-500.00 $")).toContain("text-loss");
  });

  it("отрицательный баланс красный: раньше он был белым в любом случае", () => {
    render(<GameHeader game={stateWith({ equity: 1000, balance: -250 })} styleLabel="day" playerName="Тест" />);
    expect(toneOf("-250.00 $")).toContain("text-loss");
  });

  it("положительные цифры на ровном дне не красятся вовсе", () => {
    // Зелёный на нулевом результате — это ложная радость: красим, только
    // когда есть знак.
    render(<GameHeader game={stateWith({ equity: 10_000, balance: 10_000 })} styleLabel="day" playerName="Тест" />);
    const tone = toneOf("10,000 $");
    expect(tone).not.toContain("text-profit");
    expect(tone).not.toContain("text-loss");
  });

  it("прибыльный день красит эквити зелёным", () => {
    render(
      <GameHeader game={stateWith({ equity: 11_000, balance: 11_000, dayStart: 10_000 })} styleLabel="day" playerName="Тест" />,
    );
    expect(toneOf("11,000 $")).toContain("text-profit");
  });

  it("убыточный день красит эквити красным", () => {
    render(
      <GameHeader game={stateWith({ equity: 9_000, balance: 9_000, dayStart: 10_000 })} styleLabel="day" playerName="Тест" />,
    );
    expect(toneOf("9,000 $")).toContain("text-loss");
  });
});
