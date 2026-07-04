// Shared constants and helpers for manual trade annotations.
// Kept free of server-only imports so it can be used on the client too.

export const DEFAULT_ENTRY_POINTS = [
  "Нет реакции на ложный пробой",
  "Наторговка",
  "Ретест",
];
export const DEFAULT_ENTRY_TYPES = ["Консервативный", "Агрессивный"];
export const DEFAULT_MISTAKES = [
  "Сделка не по алгоритму",
  "Ранний вход",
  "Превышен риск",
];
export const DEFAULT_PATTERNS = [
  "Пробой",
  "Ложный пробой",
  "Сложный ложный пробой",
  "Отбой",
];

export const UNSET_LABEL = "Не задано";

// Parse a JSON string of options, falling back to defaults when empty/invalid.
export function parseOptions(raw: string | null | undefined, fallback: string[]): string[] {
  if (!raw) return fallback;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) {
      const cleaned = arr.map((s) => s.trim()).filter(Boolean);
      return cleaned.length ? cleaned : fallback;
    }
  } catch {
    // ignore
  }
  return fallback;
}

export type AnnotationValue = {
  entryPoint: string | null;
  entryType: string | null;
  mistake: string | null;
  pattern: string | null;
  stopLoss: number | null;
};

export type UserAnnotationSettings = {
  entryPointOptions: string[];
  entryTypeOptions: string[];
  mistakeOptions: string[];
  patternOptions: string[];
};
