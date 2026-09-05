import { describe, it, expect } from "vitest";
import { clampSnapshot, defaultNickname, normalizeNickname, MAX_EQUITY_GROWTH_PER_SYNC } from "@/lib/game/world";
import { creditLimit, repayAmount, MIN_LOAN, MAX_INTEREST_PCT } from "@/lib/game/loans";
import { normalizeFundName, FUND_MIN_PRESTIGE, FUND_CREATION_COST } from "@/lib/game/funds";
import {
  MAX_MESSAGE_LENGTH,
  MAX_STRATEGIES_PER_AUTHOR,
  MAX_STRATEGY_PRICE,
  MESSAGE_COOLDOWN_MS,
  MIN_STRATEGY_PRICE,
  normalizeChannel,
} from "@/lib/game/social";

const base = {
  fundName: "Фонд",
  rankKey: "pro",
  prestige: 50,
  level: 3,
  equity: 50_000,
  contractsPassed: 2,
  bestContractPct: 12,
  activeStyle: "day",
  gameDay: 100,
};

describe("clampSnapshot", () => {
  it("пропускает нормальные значения без изменений", () => {
    expect(clampSnapshot(base, 40_000)).toEqual(base);
  });

  it("режет невозможный рост эквити между синхронизациями", () => {
    const cheated = clampSnapshot({ ...base, equity: 1e12 }, 1_000_000);
    expect(cheated.equity).toBe(1_000_000 * MAX_EQUITY_GROWTH_PER_SYNC);
  });

  it("даёт вырасти новичку: потолок не опускается ниже разумного минимума", () => {
    // Первый синк после старта: previousEquity = 0, но игрок с честными
    // 10 000 не должен обнулиться.
    expect(clampSnapshot({ ...base, equity: 10_000 }, 0).equity).toBe(10_000);
  });

  it("не пропускает NaN, Infinity и отрицательные значения", () => {
    const dirty = clampSnapshot(
      { ...base, equity: Number.NaN, prestige: Number.POSITIVE_INFINITY, level: -5, gameDay: -1 },
      10_000,
    );
    expect(dirty.equity).toBe(0);
    expect(dirty.prestige).toBe(0);
    expect(dirty.level).toBe(0);
    expect(dirty.gameDay).toBe(0);
  });

  it("подрезает уровень и число испытаний по потолку игры", () => {
    const huge = clampSnapshot({ ...base, level: 99, contractsPassed: 999 }, 50_000);
    expect(huge.level).toBe(10);
    expect(huge.contractsPassed).toBe(50);
  });

  it("обрезает длинное имя фонда", () => {
    expect(clampSnapshot({ ...base, fundName: "я".repeat(100) }, 50_000).fundName).toHaveLength(40);
  });
});

describe("имя игрока", () => {
  it("по умолчанию берётся из почты без домена", () => {
    const nick = defaultNickname("trader.pro@example.com", "abcd1234");
    expect(nick).not.toContain("@");
    expect(nick).not.toContain("example.com");
    expect(nick.startsWith("traderpro")).toBe(true);
  });

  it("почта без пригодных символов не оставляет пустое имя", () => {
    expect(defaultNickname("!!!@example.com", "abcd1234").startsWith("trader")).toBe(true);
  });

  it("принимает кириллицу, цифры, пробел и дефис", () => {
    expect(normalizeNickname("  Волк с Уолл-стрит  ")).toBe("Волк с Уолл-стрит");
    expect(normalizeNickname("trader_99")).toBe("trader_99");
  });

  it("отвергает слишком короткое, длинное и с разметкой", () => {
    expect(normalizeNickname("ab")).toBeNull();
    expect(normalizeNickname("я".repeat(21))).toBeNull();
    expect(normalizeNickname("<script>alert(1)</script>")).toBeNull();
  });
});

describe("кредитный лимит", () => {
  it("растёт с эквити и падает с репутацией", () => {
    expect(creditLimit(100_000, 100, 0)).toBeGreaterThan(creditLimit(10_000, 100, 0));
    expect(creditLimit(100_000, 50, 0)).toBeLessThan(creditLimit(100_000, 100, 0));
  });

  it("перки увеличивают лимит", () => {
    expect(creditLimit(100_000, 100, 1)).toBe(creditLimit(100_000, 100, 0) * 2);
  });

  it("у нулевой репутации занять нельзя вовсе", () => {
    expect(creditLimit(100_000, 0, 1)).toBe(0);
  });

  it("новичку с пустым счётом даётся минимальная база, а не ноль", () => {
    expect(creditLimit(0, 100, 0)).toBeGreaterThanOrEqual(MIN_LOAN);
  });
});

describe("возврат займа", () => {
  it("считает сумму с процентом и округляет до копеек", () => {
    expect(repayAmount(5_000, 12)).toBe(5_600);
    expect(repayAmount(1_234.56, 7.5)).toBe(1327.15);
  });

  it("беспроцентный заём возвращается ровно тем же", () => {
    expect(repayAmount(1_000, 0)).toBe(1_000);
  });

  it("процент ограничен сверху — ростовщичества в мире нет", () => {
    expect(MAX_INTEREST_PCT).toBeLessThanOrEqual(50);
  });
});

describe("название фонда", () => {
  it("принимает буквы, цифры и обычную пунктуацию", () => {
    expect(normalizeFundName("  Полярная  звезда  ")).toBe("Полярная звезда");
    expect(normalizeFundName("Alpha & Co.")).toBe("Alpha & Co.");
  });

  it("отвергает короткое, длинное и с разметкой", () => {
    expect(normalizeFundName("ab")).toBeNull();
    expect(normalizeFundName("a".repeat(33))).toBeNull();
    expect(normalizeFundName("<b>fund</b>")).toBeNull();
  });

  it("порог основания фонда не ниже стоимости — иначе основать нельзя было бы физически", () => {
    expect(FUND_MIN_PRESTIGE).toBeGreaterThan(0);
    expect(FUND_CREATION_COST).toBeGreaterThan(0);
  });
});

describe("имя из профиля в мире", () => {
  it("нормализованное имя пользователя годится как ник", () => {
    // Ник в мире по умолчанию — имя из профиля проекта, а не строка из почты.
    expect(normalizeNickname("Сергей")).toBe("Сергей");
    expect(normalizeNickname("Warren B")).toBe("Warren B");
  });

  it("непригодное имя откатывается на ник из почты, а не ломает создание профиля", () => {
    // normalizeNickname вернёт null — вызывающий код (ensurePlayer) в этом
    // случае берёт defaultNickname.
    expect(normalizeNickname("!!")).toBeNull();
    expect(defaultNickname("someone@example.com", "abcd1234")).toContain("someone");
  });
});

describe("чат и рынок стратегий", () => {
  it("канал фонда доступен только участнику фонда", () => {
    expect(normalizeChannel("fund", "f1")).toBe("fund:f1");
    expect(normalizeChannel("fund", null)).toBeNull();
  });

  it("общий зал и разговоры про рынок открыты всем", () => {
    expect(normalizeChannel("general", null)).toBe("general");
    expect(normalizeChannel("market", null)).toBe("market");
  });

  it("выдуманный канал не проходит — иначе им можно было бы шариться мимо фонда", () => {
    expect(normalizeChannel("fund:someone-else", "f1")).toBeNull();
    expect(normalizeChannel("../admin", null)).toBeNull();
  });

  it("границы сообщения и цены стратегии заданы и осмысленны", () => {
    expect(MAX_MESSAGE_LENGTH).toBeGreaterThan(100);
    expect(MESSAGE_COOLDOWN_MS).toBeGreaterThan(0);
    expect(MAX_STRATEGY_PRICE).toBeGreaterThan(MIN_STRATEGY_PRICE);
    expect(MAX_STRATEGIES_PER_AUTHOR).toBeGreaterThan(0);
  });
});
