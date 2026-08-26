// Флаги валют для клиентских частей календаря. Отдельно от lib/econcal.ts —
// тот тянет prisma и в браузер попасть не может.

const FLAGS: Record<string, string> = {
  USD: "🇺🇸",
  EUR: "🇪🇺",
  GBP: "🇬🇧",
  JPY: "🇯🇵",
  CHF: "🇨🇭",
  AUD: "🇦🇺",
  CAD: "🇨🇦",
  NZD: "🇳🇿",
  CNY: "🇨🇳",
};

/** Валюты, которые встречаются в фиде, — порядок для чипов в настройках. */
export const CALENDAR_CURRENCIES = Object.keys(FLAGS);

export function flagFor(currency: string): string {
  return FLAGS[currency] ?? "🏳️";
}
