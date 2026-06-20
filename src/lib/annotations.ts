// Shared constants and helpers for manual trade annotations.
// Kept free of server-only imports so it can be used on the client too.

export const DEFAULT_ENTRY_POINTS = ["Пробой", "Ложный пробой", "Ретест"];
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

// Mistakes are multi-valued, stored in the (single) `mistake` column as a JSON
// array. Old rows that hold a bare string are read as a single-element list.
export function parseMistakes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return arr.map((s) => String(s).trim()).filter(Boolean);
      }
    } catch {
      // fall through to single-value
    }
  }
  return trimmed ? [trimmed] : [];
}

// Serialize a mistake list back to the column (null when empty), de-duplicated.
export function serializeMistakes(mistakes: string[]): string | null {
  const cleaned = Array.from(new Set(mistakes.map((s) => s.trim()).filter(Boolean)));
  return cleaned.length ? JSON.stringify(cleaned) : null;
}

// Find the configured mistake option that means "risk exceeded" (used to
// auto-tag trades whose loss exceeded the per-trade risk). Null if none.
export function findRiskMistake(options: string[]): string | null {
  return options.find((o) => /риск|risk/i.test(o)) ?? null;
}

export type AnnotationValue = {
  entryPoint: string | null;
  entryType: string | null;
  mistakes: string[];
  pattern: string | null;
  stopLoss: number | null;
};

export type UserAnnotationSettings = {
  entryPointOptions: string[];
  entryTypeOptions: string[];
  mistakeOptions: string[];
  patternOptions: string[];
};
