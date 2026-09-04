// Дерево перков — то, во что тратится опыт. До этого уровень рос и не давал
// ничего: игрок десятого уровня играл ровно в ту же игру, что новичок.
//
// ЖЁСТКОЕ ПРАВИЛО (проверяется тестом): перк не предсказывает цену, не
// подкручивает исполнение и не даёт денег из воздуха. Он даёт инструмент,
// условие (комиссия, маржа), доступ к рынку или скорость роста — то есть
// меняет, ВО ЧТО играешь, а не насколько тебе повезло.
import perksData from "@/data/perks.json";
import type { AssetClass, Perk, PerkState, SkillTree } from "@/engine/entities/types";

export const PERKS = perksData as Perk[];

export function freshPerkState(): PerkState {
  return { unlocked: [], spentPoints: 0 };
}

export function getPerk(id: string): Perk | undefined {
  return PERKS.find((p) => p.id === id);
}

/**
 * Очки навыка = сумма уровней по всем стилям + очки за пройденные контракты.
 * Уровень качается торговлей ЛЮБОГО стиля, поэтому очки универсальны: игрок
 * сам решает, вкладываться вглубь одного стиля или вширь.
 */
export function totalSkillPoints(skills: SkillTree, contractPoints: number): number {
  let fromLevels = 0;
  for (const progress of Object.values(skills)) fromLevels += progress.level;
  return fromLevels + contractPoints;
}

export function availablePoints(skills: SkillTree, contractPoints: number, perks: PerkState): number {
  return Math.max(0, totalSkillPoints(skills, contractPoints) - perks.spentPoints);
}

export type PerkError = "unknown_perk" | "already_unlocked" | "requires_other" | "not_enough_points";
export type PerkResult = { ok: true; perks: PerkState } | { ok: false; error: PerkError };

export function unlockPerk(perks: PerkState, perkId: string, points: number): PerkResult {
  const perk = getPerk(perkId);
  if (!perk) return { ok: false, error: "unknown_perk" };
  if (perks.unlocked.includes(perkId)) return { ok: false, error: "already_unlocked" };
  if (perk.requires.some((req) => !perks.unlocked.includes(req))) return { ok: false, error: "requires_other" };
  if (perk.cost > points) return { ok: false, error: "not_enough_points" };
  return { ok: true, perks: { unlocked: [...perks.unlocked, perkId], spentPoints: perks.spentPoints + perk.cost } };
}

export interface PerkEffects {
  commissionMultiplier: number; // множитель к комиссии
  marginMultiplier: number; // множитель к требуемой марже
  xpMultiplier: number;
  dividendMultiplier: number;
  upkeepMultiplier: number;
  liquidationBuffer: number; // насколько «дальше» отодвигается цена ликвидации, доля
  loanLimitBonus: number; // насколько больше можно занять у других игроков
  tools: { orderBookAnywhere: boolean; screener: boolean; newsRadar: boolean };
  markets: AssetClass[];
}

export function perkEffects(perks: PerkState): PerkEffects {
  const has = (id: string) => perks.unlocked.includes(id);
  return {
    commissionMultiplier: has("PK_COMMISSION_2") ? 0.7 : has("PK_COMMISSION_1") ? 0.85 : 1,
    marginMultiplier: has("PK_MARGIN_RELIEF") ? 0.9 : 1,
    xpMultiplier: has("PK_XP_BOOST") ? 1.25 : 1,
    dividendMultiplier: has("PK_DIVIDEND_EDGE") ? 1.2 : 1,
    upkeepMultiplier: has("PK_FRUGAL") ? 0.8 : 1,
    liquidationBuffer: has("PK_STEADY_HAND") ? 0.1 : 0,
    loanLimitBonus: has("PK_CREDIT_LINE") ? 1 : has("PK_NETWORK") ? 0.5 : 0,
    tools: {
      orderBookAnywhere: has("PK_ORDERBOOK"),
      screener: has("PK_SCREENER"),
      newsRadar: has("PK_NEWS_RADAR"),
    },
    markets: [],
  };
}
