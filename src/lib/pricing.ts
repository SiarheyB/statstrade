/**
 * Состав тарифа для страницы /pricing.
 *
 * Тариф один и бесплатный, поэтому здесь не «сравнение планов», а один список:
 * что входит и где границы. Каждая возможность — отдельной строкой, без
 * склейки трёх разделов в один пункт: человек ищет глазами конкретное («карта
 * ликвидаций есть?»), а не вычитывает это из абзаца.
 *
 * Лимиты не вынесены в отдельный блок, а стоят значением в своей же строке —
 * «Менторских ссылок · 5», «Сырые данные стакана · 7 дней». Так число видно
 * там, где о нём думаешь, а не отдельной сноской внизу страницы.
 *
 * Тексты лежат в словаре (pricing.*), здесь только структура.
 */

export type PricingItem = {
  /** Ключ строки: pricing.item.<key> в словаре. */
  key: string;
  /**
   * Значение справа вместо галочки: ключ pricing.value.<value> в словаре.
   * Пусто — просто «есть».
   */
  value?: string;
};

export type PricingGroup = {
  /** Ключ группы: pricing.group.<key>.title в словаре. */
  key: string;
  items: PricingItem[];
};

export const PRICING_GROUPS: PricingGroup[] = [
  {
    key: "connect",
    items: [
      { key: "exchanges" },
      { key: "demoKeys" },
      { key: "mt" },
      { key: "multiAccount", value: "unlimited" },
      { key: "autoSync" },
      { key: "csv" },
    ],
  },
  {
    // Риск-менеджер и режим ментора живут здесь же: оба про работу над
    // результатом, а отдельной группой на два пункта список только рябил бы.
    key: "analytics",
    items: [
      { key: "metrics" },
      { key: "equity" },
      { key: "calendar" },
      { key: "heatmaps" },
      { key: "breakdowns" },
      { key: "exitEfficiency" },
      { key: "monteCarlo" },
      { key: "tradeChart" },
      { key: "annotations" },
      { key: "screenshots" },
      { key: "playbooks" },
      { key: "riskManager" },
      { key: "mentor", value: "links5" },
      { key: "tradeHistory", value: "unlimitedTime" },
    ],
  },
  {
    key: "market",
    items: [
      { key: "setups" },
      { key: "footprint" },
      { key: "heatmapBook" },
      { key: "absorption" },
      { key: "volumeProfile" },
      { key: "liqmap" },
      { key: "econcal" },
    ],
  },
];

/** Вопросы, которые задают про бесплатный тариф. */
export const PRICING_FAQ = ["why", "willPay", "keys", "data", "limits"] as const;
