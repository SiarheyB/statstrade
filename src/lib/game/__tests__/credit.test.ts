import { describe, it, expect } from "vitest";
import {
  canPledge,
  collateralLoan,
  creditScore,
  LTV_BY_CATEGORY,
  MAX_SCORE,
  MIN_SCORE,
  rateFor,
  repossessionPrice,
  scoreBand,
  unsecuredLimit,
  type CreditProfile,
} from "@/lib/game/credit";
import { SHOP_ITEMS, getShopItem } from "@/engine/economy/shop";

const good: CreditProfile = {
  reliability: 100,
  bankruptcies: 0,
  contractsPassed: 5,
  equity: 50_000,
  currentDebt: 0,
  ageDays: 365,
};

describe("кредитный скоринг", () => {
  it("балл лежит в привычной шкале 300-850", () => {
    for (const profile of [good, { ...good, reliability: 0, contractsPassed: 0, ageDays: 0, currentDebt: 1e9 }]) {
      const score = creditScore(profile);
      expect(score).toBeGreaterThanOrEqual(MIN_SCORE);
      expect(score).toBeLessThanOrEqual(MAX_SCORE);
    }
  });

  it("платёжная дисциплина — самый тяжёлый фактор", () => {
    const disciplined = creditScore(good);
    const sloppy = creditScore({ ...good, reliability: 20 });
    expect(disciplined - sloppy).toBeGreaterThan(100);
  });

  it("долговая нагрузка снижает балл: это и есть DTI", () => {
    const clean = creditScore(good);
    const loaded = creditScore({ ...good, currentDebt: good.equity });
    expect(loaded).toBeLessThan(clean);
  });

  it("банкротство бьёт сильно и надолго", () => {
    const once = creditScore({ ...good, bankruptcies: 1 });
    const twice = creditScore({ ...good, bankruptcies: 2 });
    expect(once).toBeLessThan(creditScore(good) - 150);
    expect(twice).toBeLessThan(once);
  });

  it("вчерашний заёмщик слабее давнего при прочих равных", () => {
    expect(creditScore({ ...good, ageDays: 1 })).toBeLessThan(creditScore(good));
  });
});

describe("ставка и лимит", () => {
  it("чем хуже балл, тем дороже деньги", () => {
    const rates = [800, 700, 600, 520, 400].map((score) => rateFor(score, false));
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThan(rates[i - 1]);
  });

  it("под залог дешевле: банку есть что забрать", () => {
    for (const score of [800, 650, 450]) {
      expect(rateFor(score, true)).toBeLessThan(rateFor(score, false));
    }
  });

  it("лимит без залога считается от капитала, а не от желания", () => {
    expect(unsecuredLimit(800, 10_000, 0)).toBeGreaterThan(unsecuredLimit(600, 10_000, 0));
    expect(unsecuredLimit(800, 100_000, 0)).toBeGreaterThan(unsecuredLimit(800, 10_000, 0));
  });

  it("уже взятое вычитается: два кредита по лимиту — это тот же лимит дважды", () => {
    const limit = unsecuredLimit(800, 10_000, 0);
    expect(unsecuredLimit(800, 10_000, limit)).toBe(0);
  });

  it("плохому заёмщику без залога не дают вовсе", () => {
    expect(scoreBand(400)).toBe("bad");
    expect(unsecuredLimit(400, 100_000, 0)).toBe(0);
  });
});

describe("залог", () => {
  it("под вещь дают ДОЛЮ её стоимости, а не всю", () => {
    for (const item of SHOP_ITEMS.filter((i) => canPledge(i.id))) {
      const loan = collateralLoan(item);
      expect(loan).toBeGreaterThan(0);
      expect(loan).toBeLessThan(item.price);
    }
  });

  it("под недвижимость дают больше, чем под предмет роскоши", () => {
    // Чем быстрее и предсказуемее вещь продаётся, тем выше LTV: яхту продать
    // труднее квартиры.
    expect(LTV_BY_CATEGORY.lifestyle).toBeGreaterThan(LTV_BY_CATEGORY.status);
  });

  it("копеечные вещи и темы в залог не годятся", () => {
    const theme = SHOP_ITEMS.find((i) => i.category === "theme")!;
    expect(canPledge(theme.id)).toBe(false);
    expect(canPledge("НЕТ_ТАКОГО")).toBe(false);
  });

  it("изъятое продаётся дешевле магазина — иначе его никто не купит", () => {
    const item = getShopItem(SHOP_ITEMS.find((i) => canPledge(i.id))!.id)!;
    expect(repossessionPrice(item)).toBeLessThan(item.price);
  });

  it("банк выдаёт под залог меньше, чем потом за него выручит", () => {
    // Иначе на каждом невозврате он терял бы деньги, и брать залог не имело
    // бы смысла.
    for (const item of SHOP_ITEMS.filter((i) => canPledge(i.id))) {
      expect(collateralLoan(item)).toBeLessThanOrEqual(repossessionPrice(item));
    }
  });
});
