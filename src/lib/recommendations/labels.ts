// Человекочитаемые подписи для машинных ключей levelType/signals, которые
// хранятся в LevelSetup как есть (levels.ts/breakoutSignals.ts) — БД и API
// остаются на английских ключах (стабильные, не завязаны на локаль), а сюда
// вынесен перевод только для отображения в UI.

export const LEVEL_TYPE_LABELS: Record<string, string> = {
  break_point: "точка излома тренда",
  parabar: "от параБАРа",
  mirror: "зеркальный",
  historical: "исторический",
  gap: "GAP",
  range_border: "граница range",
};

export function levelTypeLabel(type: string): string {
  return LEVEL_TYPE_LABELS[type] ?? type;
}

export const SIGNAL_LABELS: Record<string, string> = {
  small_bars_approach: "подход на малых барах",
  big_bars_approach: "подход на больших барах",
  accumulation_before_level: "накопление перед уровнем",
  long_move_no_accumulation: "длинное безоткатное движение без накопления",
  close_near_level: "закрытие дня близко к уровню",
  close_far_from_level: "закрытие дня далеко от уровня",
  open_far_from_level: "открытие дня далеко от уровня",
  near_retest: "недавний ретест уровня",
  far_retest: "дальний ретест (>30 дней)",
  no_reaction_to_false_breakout: "нет реакции на прошлый ложный пробой",
};

export function signalLabel(key: string): string {
  return SIGNAL_LABELS[key] ?? key;
}
