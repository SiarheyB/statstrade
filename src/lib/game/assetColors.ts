// Цветные метки инструментов в списке выбора (AssetPicker) — как в
// TradingView: списки растут (акции, крипта, форекс), и через месяц-два
// непонятно, зачем когда-то поставил именно эту пару. Цвет — заметка себе
// самому, без текста и полей ввода.
//
// Один цвет доступен всем бесплатно — иначе фичу нечем было бы даже
// попробовать. Остальные шесть открываются тремя предметами магазина
// (gear_tags_tier1/2/3, engine/economy/shop.ts) — по два цвета за тариф.
// Порядок в TIER_ITEM_IDS ВАЖЕН: он и есть порядок открытия цветов.

export interface AssetColorSwatch {
  id: string;
  hex: string;
}

// Первый — тот самый один бесплатный цвет. Дальше — по два на тариф, в
// порядке, в котором их отдаёт TIER_ITEM_IDS.
export const ASSET_COLOR_SWATCHES: AssetColorSwatch[] = [
  { id: "red", hex: "#ef4444" },
  { id: "blue", hex: "#3b82f6" },
  { id: "green", hex: "#22c55e" },
  { id: "orange", hex: "#f97316" },
  { id: "purple", hex: "#a855f7" },
  { id: "cyan", hex: "#06b6d4" },
  { id: "pink", hex: "#ec4899" },
];

/** Сколько цветов доступно без единой покупки. */
export const FREE_ASSET_COLORS = 1;

/** Сколько дополнительных цветов открывает каждый тариф — по порядку. */
export const TIER_ITEM_IDS = ["gear_tags_tier1", "gear_tags_tier2", "gear_tags_tier3"] as const;
const COLORS_PER_TIER = 2;

/** Сколько цветов из палитры доступно игроку с этим набором покупок. */
export function unlockedColorCount(ownedItemIds: string[]): number {
  let n = FREE_ASSET_COLORS;
  for (const id of TIER_ITEM_IDS) {
    if (ownedItemIds.includes(id)) n += COLORS_PER_TIER;
  }
  return Math.min(n, ASSET_COLOR_SWATCHES.length);
}

export function unlockedSwatches(ownedItemIds: string[]): AssetColorSwatch[] {
  return ASSET_COLOR_SWATCHES.slice(0, unlockedColorCount(ownedItemIds));
}

/** Тариф, покупкой которого открывается ИМЕННО этот (пока запертый) цвет. */
export function tierForSwatch(index: number): (typeof TIER_ITEM_IDS)[number] | null {
  const tierIndex = Math.floor((index - FREE_ASSET_COLORS) / COLORS_PER_TIER);
  return TIER_ITEM_IDS[tierIndex] ?? null;
}
