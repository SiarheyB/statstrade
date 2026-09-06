import { describe, it, expect } from "vitest";
import {
  centralBankStance,
  centralBankDriftBias,
  bigPlayerDriftBias,
  BIG_PLAYER_MAX_DRIFT_BIAS,
  BIG_PLAYER_START_EQUITY,
  CENTRAL_BANK_ASSET_ID,
} from "@/lib/game/marketMovers";
import { getAsset } from "@/lib/game/marketStore";

describe("политика центробанка", () => {
  it("поддерживает рынок в кризис и медвежьем рынке, а не разгоняет падение", () => {
    expect(centralBankStance("crisis").side).toBe("long");
    expect(centralBankStance("bear").side).toBe("long");
  });

  it("охлаждает перегрев, а не подыгрывает росту", () => {
    expect(centralBankStance("bull").side).toBe("short");
    expect(centralBankStance("high_volatility").side).toBe("short");
  });

  it("в боковике не вмешивается — там нечего сглаживать", () => {
    expect(centralBankStance("sideways").side).toBe("flat");
    expect(centralBankStance("sideways").sharePct).toBe(0);
  });

  it("кризис — самая крупная мера, боковик — нулевая", () => {
    const shares = ["crisis", "bear", "bull", "high_volatility"].map((r) => centralBankStance(r as never).sharePct);
    expect(Math.max(...shares)).toBe(centralBankStance("crisis").sharePct);
    expect(shares.every((s) => s > 0)).toBe(true);
  });

  it("снос смягчает крайность, а не отменяет её", () => {
    // Кризис у обычного режима даёт driftModifier = -3 (сильно отрицательный).
    // Добавка центробанка положительна, но заметно МЕНЬШЕ по модулю — рынок
    // в кризисе всё равно падает, просто не так резко.
    const bias = centralBankDriftBias("crisis");
    expect(bias).toBeGreaterThan(0);
    expect(bias).toBeLessThan(3);
  });

  it("флагманский индекс существует в данных мира", () => {
    expect(getAsset(CENTRAL_BANK_ASSET_ID)).toBeTruthy();
  });
});

describe("снос от позиции крупных ботов", () => {
  it("нулевая позиция — нулевой снос", () => {
    expect(bigPlayerDriftBias(0)).toBe(0);
  });

  it("лонг двигает цену вверх, шорт — вниз", () => {
    expect(bigPlayerDriftBias(1_000_000)).toBeGreaterThan(0);
    expect(bigPlayerDriftBias(-1_000_000)).toBeLessThan(0);
  });

  it("не разгоняется бесконечно — есть потолок", () => {
    // Позиция в 50 раз больше стартового капитала не должна давать снос
    // в 50 раз сильнее потолка.
    const huge = bigPlayerDriftBias(BIG_PLAYER_START_EQUITY * 50);
    expect(huge).toBe(BIG_PLAYER_MAX_DRIFT_BIAS);
    expect(bigPlayerDriftBias(-BIG_PLAYER_START_EQUITY * 50)).toBe(-BIG_PLAYER_MAX_DRIFT_BIAS);
  });

  it("растёт пропорционально размеру позиции, пока не упёрлось в потолок", () => {
    expect(bigPlayerDriftBias(BIG_PLAYER_START_EQUITY)).toBeCloseTo(1, 5);
    expect(bigPlayerDriftBias(BIG_PLAYER_START_EQUITY / 2)).toBeCloseTo(0.5, 5);
  });
});
