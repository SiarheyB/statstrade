import { describe, it, expect } from "vitest";
import {
  applySponsorCut,
  isWipedOut,
  sponsorCut,
  sponsorOffer,
  SPONSOR_REPAY_MULTIPLIER,
  SPONSOR_SHARE_PCT,
  WIPEOUT_THRESHOLD_PCT,
} from "@/engine/player/bailout";
import type { Position } from "@/engine/entities/types";

const position = (patch: Partial<Position> = {}): Position => ({
  id: "p1",
  assetId: "A",
  side: "long",
  entryPrice: 100,
  size: 1,
  leverage: 1,
  openedAt: 0,
  fees: 0,
  style: "day",
  ...patch,
});

describe("определение разорения", () => {
  it("пустой счёт без позиций — разорение", () => {
    expect(isWipedOut(100, [], 10_000)).toBe(true);
  });

  it("живой счёт — нет", () => {
    expect(isWipedOut(9_000, [], 10_000)).toBe(false);
  });

  it("пока открыта позиция, разорения не объявляем — эквити ещё может вернуться", () => {
    expect(isWipedOut(100, [position()], 10_000)).toBe(false);
  });

  it("закрытые позиции в истории не мешают увидеть разорение", () => {
    expect(isWipedOut(100, [position({ closedAt: 1 })], 10_000)).toBe(true);
  });

  it("порог — доля от стартового капитала, а не абсолютные деньги", () => {
    const edge = 10_000 * (WIPEOUT_THRESHOLD_PCT / 100);
    expect(isWipedOut(edge, [], 10_000)).toBe(true);
    expect(isWipedOut(edge + 1, [], 10_000)).toBe(false);
  });
});

describe("условия спонсора", () => {
  it("ставка — половина стартового капитала, вернуть надо больше, чем дали", () => {
    const deal = sponsorOffer(10_000);
    expect(deal.stake).toBe(5_000);
    expect(deal.owed).toBe(Math.round(5_000 * SPONSOR_REPAY_MULTIPLIER));
    expect(deal.owed).toBeGreaterThan(deal.stake);
    expect(deal.sharePct).toBe(SPONSOR_SHARE_PCT);
  });

  it("доля берётся только с прибыли — убыток целиком игрока", () => {
    const deal = sponsorOffer(10_000);
    expect(sponsorCut(deal, 1_000)).toBeCloseTo(300, 6);
    expect(sponsorCut(deal, -1_000)).toBe(0);
    expect(sponsorCut(null, 1_000)).toBe(0);
  });

  it("удержание не превышает остаток долга", () => {
    const deal = { ...sponsorOffer(10_000), owed: 100 };
    expect(sponsorCut(deal, 10_000)).toBe(100);
  });

  it("договор заканчивается сам, когда долг закрыт", () => {
    const deal = { ...sponsorOffer(10_000), owed: 100 };
    expect(applySponsorCut(deal, 100, 5)).toBeNull();
    const left = applySponsorCut(deal, 40, 5);
    expect(left?.owed).toBe(60);
    expect(left?.settledTrades).toBe(5);
  });
});
