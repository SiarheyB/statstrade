import { describe, it, expect } from "vitest";
import {
  applyPurchase,
  canPurchase,
  chargeUpkeep,
  DEFAULT_THEME_ID,
  FORCED_SALE_RATE,
  graceExpired,
  pickForcedSale,
  releaseItem,
  SELF_SALE_RATE,
  settleUpkeepDebt,
  sellValue,
  UPKEEP_GRACE_DAYS,
  equipTheme,
  freshLifestyle,
  getShopItem,
  monthlyUpkeep,
  nextRank,
  SHOP_ITEMS,
  traderRankKey,
} from "@/engine/economy/shop";
import type { Account, ShopItem } from "@/engine/entities/types";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "player",
    balance: 10_000,
    equity: 10_000,
    positions: [],
    pendingOrders: [],
    marginUsed: 0,
    marginLevel: Infinity,
    psychology: { stress: 0, confidence: 50, discipline: 0, consecutiveWins: 0, consecutiveLosses: 0, lastTradeAt: 0 },
    skills: {},
    reputation: 0,
    licenses: [],
    journal: [],
    ...overrides,
  };
}

function item(overrides: Partial<ShopItem> = {}): ShopItem {
  return {
    id: "test_item",
    category: "gear",
    price: 1000,
    upkeepPerMonth: 50,
    prestige: 10,
    requiresPrestige: 0,
    icon: "🧪",
    ...overrides,
  };
}

describe("каталог магазина", () => {
  it("ни один предмет не влияет на рынок и на исполнение (F2P-safe)", () => {
    // Страховка от будущей правки данных: если в shopItems.json когда-нибудь
    // добавят поле вроде commissionDiscount/priceEdge/luck — тест упадёт, и
    // это ровно то, что нужно.
    //
    // rest в списке разрешённых намеренно: он ускоряет восстановление от
    // стресса (раздел 4.4), то есть возвращает игрока в НОРМУ, но не делает
    // сильнее нормы и рынка не касается. Это единственное влияние покупок на
    // игру, и оно осознанное — см. docs/game/CONCEPT.md, решение по развилке 1.
    const allowed = new Set(["id", "category", "price", "upkeepPerMonth", "prestige", "requiresPrestige", "icon", "theme", "rest"]);
    for (const shopItem of SHOP_ITEMS) {
      for (const key of Object.keys(shopItem)) expect(allowed).toContain(key);
    }
  });

  it("тема по умолчанию есть в каталоге и бесплатна", () => {
    const theme = getShopItem(DEFAULT_THEME_ID);
    expect(theme?.category).toBe("theme");
    expect(theme?.price).toBe(0);
  });

  it("порог престижа у каждого предмета достижим суммой престижа более дешёвых", () => {
    // Иначе предмет был бы заперт навсегда: престиж начисляется ТОЛЬКО за
    // покупки, и требовать 200 очков там, где всё доступное даёт 150, —
    // тупик, который на глаз в JSON не виден.
    const sorted = [...SHOP_ITEMS].sort((a, b) => a.price - b.price);
    let reachablePrestige = 0;
    for (const shopItem of sorted) {
      expect(shopItem.requiresPrestige).toBeLessThanOrEqual(reachablePrestige);
      reachablePrestige += shopItem.prestige;
    }
  });
});

describe("canPurchase", () => {
  it("пропускает покупку, когда денег и престижа хватает", () => {
    expect(canPurchase(item(), 10_000, freshLifestyle(), 0)).toEqual({ ok: true });
  });

  it("уже купленный предмет не продаётся второй раз", () => {
    const lifestyle = { ...freshLifestyle(), ownedItemIds: [DEFAULT_THEME_ID, "test_item"] };
    expect(canPurchase(item(), 10_000, lifestyle, 100)).toEqual({ ok: false, error: "already_owned" });
  });

  it("нехватка престижа важнее нехватки денег: игрок должен видеть настоящую причину", () => {
    const locked = item({ price: 1_000_000, requiresPrestige: 50 });
    expect(canPurchase(locked, 0, freshLifestyle(), 10)).toEqual({ ok: false, error: "locked" });
  });

  it("отклоняет покупку дороже баланса", () => {
    expect(canPurchase(item({ price: 20_000 }), 10_000, freshLifestyle(), 0)).toEqual({
      ok: false,
      error: "insufficient_funds",
    });
  });

  it("неизвестный предмет — отдельная ошибка, а не падение", () => {
    expect(canPurchase(undefined, 10_000, freshLifestyle(), 0)).toEqual({ ok: false, error: "unknown_item" });
  });
});

describe("applyPurchase", () => {
  it("списывает цену, начисляет престиж и добавляет предмет во владение", () => {
    const account = makeAccount();
    const lifestyle = applyPurchase(account, freshLifestyle(), item());
    expect(account.balance).toBe(9_000);
    expect(account.reputation).toBe(10);
    expect(lifestyle.ownedItemIds).toContain("test_item");
    expect(lifestyle.totalSpent).toBe(1_000);
  });

  it("купленная тема надевается сразу, купленная не-тема активную тему не трогает", () => {
    const account = makeAccount({ balance: 100_000 });
    const afterTheme = applyPurchase(account, freshLifestyle(), item({ id: "theme_x", category: "theme" }));
    expect(afterTheme.equippedThemeId).toBe("theme_x");
    const afterGear = applyPurchase(account, afterTheme, item({ id: "gear_x" }));
    expect(afterGear.equippedThemeId).toBe("theme_x");
  });

  it("не мутирует переданный LifestyleState (на него подписан zustand)", () => {
    const before = freshLifestyle();
    applyPurchase(makeAccount(), before, item());
    expect(before.ownedItemIds).toEqual([DEFAULT_THEME_ID]);
    expect(before.totalSpent).toBe(0);
  });
});

describe("equipTheme", () => {
  it("не даёт надеть некупленную тему", () => {
    const lifestyle = freshLifestyle();
    expect(equipTheme(lifestyle, "theme_gold").equippedThemeId).toBe(DEFAULT_THEME_ID);
  });

  it("не даёт надеть купленный предмет, который не является темой", () => {
    const lifestyle = { ...freshLifestyle(), ownedItemIds: [DEFAULT_THEME_ID, "gear_chair"] };
    expect(equipTheme(lifestyle, "gear_chair").equippedThemeId).toBe(DEFAULT_THEME_ID);
  });
});

describe("содержание (upkeep)", () => {
  it("суммирует ежемесячный расход по всему купленному", () => {
    const lifestyle = { ...freshLifestyle(), ownedItemIds: [DEFAULT_THEME_ID, "gear_coffee", "life_studio"] };
    const expected = (getShopItem("gear_coffee")?.upkeepPerMonth ?? 0) + (getShopItem("life_studio")?.upkeepPerMonth ?? 0);
    expect(monthlyUpkeep(lifestyle)).toBe(expected);
  });

  it("свежий профиль ничего не стоит в содержании", () => {
    expect(monthlyUpkeep(freshLifestyle())).toBe(0);
  });

  it("списывает расход с баланса и копит статистику", () => {
    const account = makeAccount({ balance: 5_000 });
    const { lifestyle, paid, shortfall } = chargeUpkeep(account, freshLifestyle(), 900);
    expect(account.balance).toBe(4_100);
    expect(paid).toBe(900);
    expect(shortfall).toBe(0);
    expect(lifestyle.totalUpkeepPaid).toBe(900);
  });

  it("не уводит баланс в минус — недостача копится отдельно", () => {
    const account = makeAccount({ balance: 300 });
    const { lifestyle, paid, shortfall } = chargeUpkeep(account, freshLifestyle(), 900);
    expect(account.balance).toBe(0);
    expect(paid).toBe(300);
    expect(shortfall).toBe(600);
    expect(lifestyle.unpaidUpkeep).toBe(600);
  });

  it("гасит старый долг раньше текущего месяца", () => {
    // Иначе долг висел бы вечно у того, кто кое-как тянет ежемесячные.
    const account = makeAccount({ balance: 1_000 });
    const before = { ...freshLifestyle(), unpaidUpkeep: 600, upkeepDebtSince: 1_000 };
    const { lifestyle, shortfall } = chargeUpkeep(account, before, 900);
    expect(account.balance).toBe(0);
    expect(shortfall).toBe(500);
    expect(lifestyle.unpaidUpkeep).toBe(500);
    // Отсчёт льготного срока не сдвинулся: долг тот же самый.
    expect(lifestyle.upkeepDebtSince).toBe(1_000);
  });

  it("снимает отметку долга, когда его закрыли", () => {
    const account = makeAccount({ balance: 5_000 });
    const before = { ...freshLifestyle(), unpaidUpkeep: 600, upkeepDebtSince: 1_000 };
    const { lifestyle } = chargeUpkeep(account, before, 900);
    expect(lifestyle.unpaidUpkeep).toBe(0);
    expect(lifestyle.upkeepDebtSince).toBeNull();
  });
});

describe("долг по содержанию: продажа и взыскание", () => {
  const owned = (ids: string[]) => ({ ...freshLifestyle(), ownedItemIds: [DEFAULT_THEME_ID, ...ids] });

  it("своя продажа выгоднее принудительной", () => {
    const item = getShopItem("life_car")!;
    expect(sellValue(item)).toBe(Math.floor(item.price * SELF_SALE_RATE));
    expect(sellValue(item, true)).toBe(Math.floor(item.price * FORCED_SALE_RATE));
    expect(sellValue(item, true)).toBeLessThan(sellValue(item));
  });

  it("забирает самое дешёвое, чего хватает на долг", () => {
    // За долг в триста долларов не должны отнимать яхту: кофемашины (600 $,
    // при взыскании 300) хватает ровно впритык.
    const picked = pickForcedSale(owned(["gear_coffee", "life_car", "life_yacht"]), 300);
    expect(picked?.id).toBe("gear_coffee");
  });

  it("берёт дороже, если дешёвого не хватает", () => {
    // Долг 1 000 — кофемашина за 300 его не закроет, машина за 45 000 да.
    expect(pickForcedSale(owned(["gear_coffee", "life_car", "life_yacht"]), 1_000)?.id).toBe("life_car");
  });

  it("на неподъёмный долг забирает самое дорогое из имеющегося", () => {
    const picked = pickForcedSale(owned(["gear_coffee", "life_car", "life_yacht"]), 5_000_000);
    expect(picked?.id).toBe("life_yacht");
  });

  it("тему не забирает — она ничего не стоит в содержании", () => {
    expect(pickForcedSale(owned([]), 1_000)).toBeNull();
  });

  it("продажа возвращает деньги, снимает престиж и убирает вещь", () => {
    const item = getShopItem("life_car")!;
    const account = makeAccount({ balance: 0, reputation: item.prestige + 5 });
    const { lifestyle, received } = releaseItem(account, owned(["life_car"]), item, false);
    expect(received).toBe(sellValue(item));
    expect(account.balance).toBe(received);
    expect(account.reputation).toBe(5);
    expect(lifestyle.ownedItemIds).not.toContain("life_car");
  });

  it("продажа лицензии стирает имя фонда, продажа темы — её выбор", () => {
    const account = makeAccount();
    const withFund = { ...owned(["status_fund"]), fundName: "Альфа" };
    expect(releaseItem(account, withFund, getShopItem("status_fund")!, false).lifestyle.fundName).toBe("");
  });

  it("продажа сразу гасит долг, остальное остаётся на балансе", () => {
    const item = getShopItem("life_car")!;
    const account = makeAccount({ balance: 0 });
    const before = { ...owned(["life_car"]), unpaidUpkeep: 1_000, upkeepDebtSince: 1_000 };
    const sold = releaseItem(account, before, item, false);
    const after = settleUpkeepDebt(account, sold.lifestyle);
    expect(after.unpaidUpkeep).toBe(0);
    expect(after.upkeepDebtSince).toBeNull();
    expect(account.balance).toBe(sellValue(item) - 1_000);
  });

  it("частичная выручка уменьшает долг, но срок не обнуляет", () => {
    const item = getShopItem("gear_coffee")!;
    const account = makeAccount({ balance: 0 });
    const before = { ...owned(["gear_coffee"]), unpaidUpkeep: 1_000, upkeepDebtSince: 1_000 };
    const sold = releaseItem(account, before, item, false);
    const after = settleUpkeepDebt(account, sold.lifestyle);
    expect(after.unpaidUpkeep).toBe(1_000 - sellValue(item));
    expect(after.upkeepDebtSince).toBe(1_000);
    expect(account.balance).toBe(0);
  });

  it("льготный срок идёт от появления долга", () => {
    const debtStart = 1_000_000;
    const lifestyle = { ...freshLifestyle(), unpaidUpkeep: 600, upkeepDebtSince: debtStart };
    const day = 24 * 60 * 60 * 1000;
    expect(graceExpired(lifestyle, debtStart + (UPKEEP_GRACE_DAYS - 1) * day)).toBe(false);
    expect(graceExpired(lifestyle, debtStart + UPKEEP_GRACE_DAYS * day)).toBe(true);
    // Без долга срок не истекает вовсе.
    expect(graceExpired(freshLifestyle(), Date.now())).toBe(false);
  });
});

describe("ранги трейдера", () => {
  it("растут вместе с престижем", () => {
    expect(traderRankKey(0)).toBe("retail");
    expect(traderRankKey(20)).toBe("junior");
    expect(traderRankKey(1000)).toBe("legend");
  });

  it("показывают, сколько осталось до следующего ранга, и молчат на максимуме", () => {
    expect(nextRank(0)).toEqual({ key: "junior", remaining: 20 });
    expect(nextRank(10_000)).toBeNull();
  });
});
