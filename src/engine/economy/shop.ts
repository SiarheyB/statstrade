// Магазин и «жизнь трейдера» — раздел 13 спеки. Прямой ответ на просьбу
// пользователя «подумай о жизни трейдера, о покупках»: заработанные в
// симуляторе деньги должно быть КУДА тратить, иначе баланс — просто счётчик.
//
// Правило, которое здесь нельзя нарушать (F2P-safe, раздел 13): ни один
// предмет не влияет на RNG цены, исполнение ордеров, комиссии, плечо или
// маржу. Всё, что даёт покупка, — это внешний вид терминала, очки престижа
// (account.reputation, поле существовало с Фазы 1 и до сих пор не
// использовалось) и ежемесячный расход на содержание. Поэтому даже если
// когда-нибудь появится реальная монетизация, купить преимущество будет
// физически нечего.
//
// Расход на содержание (upkeepPerMonth) — вторая половина той же мысли:
// дивиденды (economy/dividends.ts) дают пассивный ДОХОД раз в игровой
// квартал, образ жизни — пассивный РАСХОД раз в игровой месяц. Вместе они и
// делают «жизнь», а не только сделки: яхта не только стоит миллион, её ещё
// надо содержать.
import shopItemsData from "@/data/shopItems.json";
import type { Account, LifestyleState, ShopCategory, ShopItem } from "@/engine/entities/types";

export const SHOP_ITEMS = shopItemsData as ShopItem[];

// Синяя схема по умолчанию — та же, что была у терминала до магазина
// (--color-accent из globals.css): игрок с нулевым балансом видит ровно тот
// же терминал, что и раньше, а не «урезанную» версию.
export const DEFAULT_THEME_ID = "theme_classic";

export const SHOP_CATEGORIES: ShopCategory[] = ["theme", "gear", "lifestyle", "status"];

// Предмет, который открывает переименование фонда (раздел 13 — «переименование
// фонда»). Отдельная константа, а не строка по месту: на неё смотрит и UI, и
// стор.
export const FUND_LICENSE_ITEM_ID = "status_fund";

export function getShopItem(id: string): ShopItem | undefined {
  return SHOP_ITEMS.find((i) => i.id === id);
}

export function freshLifestyle(): LifestyleState {
  return {
    ownedItemIds: [DEFAULT_THEME_ID],
    equippedThemeId: DEFAULT_THEME_ID,
    fundName: "",
    totalSpent: 0,
    totalUpkeepPaid: 0,
    unpaidUpkeep: 0,
  };
}

export type PurchaseError = "unknown_item" | "already_owned" | "insufficient_funds" | "locked";
export type PurchaseCheck = { ok: true } | { ok: false; error: PurchaseError };

/**
 * Проверка ДО списания денег. Порядок ошибок важен для UI: сначала «уже
 * куплено» (кнопка вообще не должна предлагать покупку), потом «не хватает
 * престижа» (видно, к чему стремиться), и только потом «не хватает денег» —
 * иначе на дорогом заблокированном предмете игрок видел бы «не хватает
 * денег» и копил бы зря, не понимая, что дело в репутации.
 */
export function canPurchase(item: ShopItem | undefined, balance: number, lifestyle: LifestyleState, prestige: number): PurchaseCheck {
  if (!item) return { ok: false, error: "unknown_item" };
  if (lifestyle.ownedItemIds.includes(item.id)) return { ok: false, error: "already_owned" };
  if (prestige < item.requiresPrestige) return { ok: false, error: "locked" };
  if (item.price > balance) return { ok: false, error: "insufficient_funds" };
  return { ok: true };
}

/**
 * Списывает деньги, начисляет престиж и добавляет предмет во владение.
 * Мутирует переданный account (вызывающий передаёт уже скопированный
 * черновик — тот же контракт, что у applyPositionClose в gameLoop.ts), а
 * LifestyleState возвращает НОВЫМ объектом: на него подписан zustand, и
 * мутация на месте не вызвала бы перерисовку магазина.
 *
 * Тему при покупке сразу надеваем: покупка темы, которая никак не
 * проявилась, выглядела бы как «деньги списались, ничего не произошло».
 */
export function applyPurchase(account: Account, lifestyle: LifestyleState, item: ShopItem): LifestyleState {
  account.balance -= item.price;
  account.reputation += item.prestige;
  return {
    ...lifestyle,
    ownedItemIds: [...lifestyle.ownedItemIds, item.id],
    equippedThemeId: item.category === "theme" ? item.id : lifestyle.equippedThemeId,
    totalSpent: lifestyle.totalSpent + item.price,
  };
}

export function equipTheme(lifestyle: LifestyleState, themeId: string): LifestyleState {
  // Надеть можно только купленное — иначе тему можно было бы «примерить»
  // мимо кассы, подсунув id из devtools.
  if (!lifestyle.ownedItemIds.includes(themeId)) return lifestyle;
  const item = getShopItem(themeId);
  if (!item || item.category !== "theme") return lifestyle;
  return { ...lifestyle, equippedThemeId: themeId };
}

export function activeTheme(lifestyle: LifestyleState) {
  const item = getShopItem(lifestyle.equippedThemeId ?? DEFAULT_THEME_ID);
  return item?.theme ?? getShopItem(DEFAULT_THEME_ID)?.theme;
}

/**
 * Суммарный множитель восстановления от стресса: 1 — обычная скорость, выше
 * — быстрее. Складывается из купленного (кресло, кофе, дом у моря): отдых
 * помогает прийти в себя, а не обыграть рынок.
 */
export function restFactor(lifestyle: LifestyleState): number {
  let bonus = 0;
  for (const id of lifestyle.ownedItemIds) bonus += getShopItem(id)?.rest ?? 0;
  return 1 + bonus;
}

/** Суммарный расход на содержание за один игровой месяц. */
export function monthlyUpkeep(lifestyle: LifestyleState): number {
  let total = 0;
  for (const id of lifestyle.ownedItemIds) total += getShopItem(id)?.upkeepPerMonth ?? 0;
  return total;
}

/**
 * Списывает расход на содержание. Баланс НИКОГДА не уходит в минус: если
 * денег не хватило, списываем сколько есть, а недостачу копим в
 * unpaidUpkeep — UI показывает предупреждение «расходы больше дохода».
 * Уводить баланс в отрицательный «долг» было бы честнее по жизни, но ломает
 * весь остальной движок (openPosition сравнивает cost > balance, equity
 * уходит в минус, метрики портфеля считают просадку от отрицательной базы) —
 * ADJUSTED FROM SPEC ради устойчивости симуляции.
 *
 * Мутирует account, возвращает фактически списанное и недостачу.
 */
export function chargeUpkeep(account: Account, lifestyle: LifestyleState, upkeep: number): { lifestyle: LifestyleState; paid: number; shortfall: number } {
  if (upkeep <= 0) return { lifestyle, paid: 0, shortfall: 0 };
  const paid = Math.min(upkeep, Math.max(0, account.balance));
  const shortfall = upkeep - paid;
  account.balance -= paid;
  return {
    lifestyle: {
      ...lifestyle,
      totalUpkeepPaid: lifestyle.totalUpkeepPaid + paid,
      unpaidUpkeep: lifestyle.unpaidUpkeep + shortfall,
    },
    paid,
    shortfall,
  };
}

// Ранг трейдера по очкам престижа — видимая «лестница» вместо голого числа
// репутации. Пороги подобраны так, чтобы первый ранг брался парой дешёвых
// покупок, а последний требовал уже яхты/пентхауса (раздел 13 — статус как
// долгосрочная цель, не как буст).
export const TRADER_RANKS: { minPrestige: number; key: string }[] = [
  { minPrestige: 0, key: "retail" },
  { minPrestige: 20, key: "junior" },
  { minPrestige: 60, key: "pro" },
  { minPrestige: 150, key: "fund" },
  { minPrestige: 300, key: "legend" },
];

export function traderRankKey(prestige: number): string {
  let key = TRADER_RANKS[0].key;
  for (const rank of TRADER_RANKS) if (prestige >= rank.minPrestige) key = rank.key;
  return key;
}

/** Следующий ранг и сколько престижа до него — null, если ранг максимальный. */
export function nextRank(prestige: number): { key: string; remaining: number } | null {
  const next = TRADER_RANKS.find((r) => prestige < r.minPrestige);
  return next ? { key: next.key, remaining: next.minPrestige - prestige } : null;
}
