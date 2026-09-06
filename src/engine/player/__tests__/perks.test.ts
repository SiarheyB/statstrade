import { describe, it, expect } from "vitest";
import {
  availablePoints,
  freshPerkState,
  getPerk,
  perkEffects,
  PERKS,
  totalSkillPoints,
  unlockPerk,
} from "@/engine/player/perks";
import type { PerkState, SkillTree } from "@/engine/entities/types";

const skills: SkillTree = {
  day: { level: 3, xp: 10, xpToNextLevel: 100 },
  scalping: { level: 2, xp: 0, xpToNextLevel: 100 },
};

describe("каталог перков", () => {
  it("ни один перк не обещает влияния на цену или исполнение", () => {
    // Смысловой предохранитель: в данных перка есть только id, ветка,
    // стоимость и требования. Любое поле вроде "winRate" или "priceEdge"
    // уронит тест — и это ровно то, что нужно (см. правило в perks.ts).
    const allowed = new Set(["id", "branch", "cost", "requires"]);
    for (const perk of PERKS) {
      for (const key of Object.keys(perk)) expect(allowed).toContain(key);
    }
  });

  it("требования ссылаются на существующие перки и не зацикливаются", () => {
    for (const perk of PERKS) {
      for (const req of perk.requires) {
        expect(getPerk(req)).toBeDefined();
        expect(req).not.toBe(perk.id);
        // требование должно быть дешевле — иначе ветка нераскрываема по порядку
        expect(getPerk(req)!.cost).toBeLessThanOrEqual(perk.cost);
      }
    }
  });

  it("в каждой ветке есть хотя бы один перк без требований — вход в ветку", () => {
    const branches = new Set(PERKS.map((p) => p.branch));
    for (const branch of branches) {
      expect(PERKS.some((p) => p.branch === branch && p.requires.length === 0)).toBe(true);
    }
  });
});

describe("очки навыка", () => {
  it("складываются из уровней всех стилей и наград за контракты", () => {
    expect(totalSkillPoints(skills, 2)).toBe(7);
    expect(totalSkillPoints({}, 0)).toBe(0);
  });

  it("доступные = заработанные минус потраченные, и никогда не отрицательные", () => {
    const perks: PerkState = { unlocked: ["PK_ORDERBOOK"], spentPoints: 1 };
    expect(availablePoints(skills, 0, perks)).toBe(4);
    expect(availablePoints({}, 0, { unlocked: [], spentPoints: 99 })).toBe(0);
  });
});

describe("unlockPerk", () => {
  it("открывает перк и списывает очки", () => {
    const result = unlockPerk(freshPerkState(), "PK_ORDERBOOK", 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.perks.unlocked).toEqual(["PK_ORDERBOOK"]);
    expect(result.perks.spentPoints).toBe(1);
  });

  it("не открывает дважды, без предпосылки и без очков", () => {
    const owned: PerkState = { unlocked: ["PK_ORDERBOOK"], spentPoints: 1 };
    expect(unlockPerk(owned, "PK_ORDERBOOK", 5)).toEqual({ ok: false, error: "already_unlocked" });
    expect(unlockPerk(freshPerkState(), "PK_SCREENER", 5)).toEqual({ ok: false, error: "requires_other" });
    expect(unlockPerk(freshPerkState(), "PK_ORDERBOOK", 0)).toEqual({ ok: false, error: "not_enough_points" });
    expect(unlockPerk(freshPerkState(), "PK_NOPE", 5)).toEqual({ ok: false, error: "unknown_perk" });
  });

  it("не мутирует исходное состояние", () => {
    const before = freshPerkState();
    unlockPerk(before, "PK_ORDERBOOK", 3);
    expect(before.unlocked).toEqual([]);
    expect(before.spentPoints).toBe(0);
  });
});

describe("perkEffects", () => {
  it("без перков всё нейтрально", () => {
    const e = perkEffects(freshPerkState());
    expect(e.commissionMultiplier).toBe(1);
    expect(e.xpMultiplier).toBe(1);
    expect(e.upkeepMultiplier).toBe(1);
    expect(e.tools).toEqual({ orderBookAnywhere: false, screener: false, newsRadar: false });
  });

  it("скидки на комиссию не складываются, а заменяют друг друга", () => {
    const one = perkEffects({ unlocked: ["PK_COMMISSION_1"], spentPoints: 1 });
    const both = perkEffects({ unlocked: ["PK_COMMISSION_1", "PK_COMMISSION_2"], spentPoints: 4 });
    expect(one.commissionMultiplier).toBe(0.85);
    expect(both.commissionMultiplier).toBe(0.7); // не 0.85 * 0.7
  });

  it("инструменты включаются своими перками", () => {
    const e = perkEffects({ unlocked: ["PK_ORDERBOOK", "PK_SCREENER"], spentPoints: 3 });
    expect(e.tools.orderBookAnywhere).toBe(true);
    expect(e.tools.screener).toBe(true);
    expect(e.tools.newsRadar).toBe(false);
  });

  it("ни один множитель не выходит за разумные границы — перк не должен ломать экономику", () => {
    const all = perkEffects({ unlocked: PERKS.map((p) => p.id), spentPoints: 99 });
    expect(all.commissionMultiplier).toBeGreaterThanOrEqual(0.5);
    expect(all.xpMultiplier).toBeLessThanOrEqual(1.5);
    expect(all.dividendMultiplier).toBeLessThanOrEqual(1.5);
    expect(all.upkeepMultiplier).toBeGreaterThanOrEqual(0.5);
    expect(all.marginMultiplier - all.liquidationBuffer).toBeGreaterThan(0);
  });
});
