// Человекочитаемые подписи для машинных ключей levelType/signals, которые
// хранятся в LevelSetup как есть (levels.ts/breakoutSignals.ts) — БД и API
// остаются на английских ключах (стабильные, не завязаны на локаль), а сюда
// вынесен перевод только для отображения в UI.

export const LEVEL_TYPE_LABELS: Record<string, string> = {
  break_point: "точка излома тренда",
  parabar: "от параБАРа",
  structure_break: "подтверждённый слом структуры",
  retracement: "откат",
  mirror: "зеркальный",
  historical: "исторический",
  gap: "GAP",
  range_border: "граница range",
  local_stop: "локальная опорная точка",
};

export function levelTypeLabel(type: string): string {
  return LEVEL_TYPE_LABELS[type] ?? type;
}

export const DIRECTION_LABELS: Record<string, string> = {
  long: "лонг",
  short: "шорт",
};

export function directionLabel(direction: string | null | undefined): string {
  if (!direction) return "";
  return DIRECTION_LABELS[direction] ?? direction;
}

// Почему уровень не попал в выдачу — для статистики пересчёта в админке.
export const REJECT_REASON_LABELS: Record<string, string> = {
  close_far_from_level: "день закрылся далеко от уровня",
  did_not_reach_level: "вчера до уровня не дошли",
  close_near_level: "вчера подошли слишком близко для ЛП (нет разгона на прокол)",
  level_chopped: "уровень распилен",
  too_many_false_breakouts: "слишком много ложных пробоев",
  deep_false_breakout: "был глубокий ложный пробой",
  contaminated_zone: "за уровнем проторгованная зона",
  no_runway: "нет запаса хода до следующего уровня",
  no_breakout_preconditions: "нет предпосылок к пробою (подход не спокойный)",
  no_false_breakout_preconditions: "нет предпосылок к ЛП (подход не быстрый)",
  counter_trend: "Сетап против глобального тренда",
  not_retracement_source: "уровень не от отката структуры",
  retest_too_recent: "уровень касали меньше 10 дней назад",
};

export function rejectReasonLabel(key: string): string {
  return REJECT_REASON_LABELS[key] ?? key;
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
  volume_supports_impulse: "объём подтверждает импульс",
  volume_spike_on_pierce: "всплеск объёма на проколе уровня",
  paranormal_no_pullback: "паранормальный бар без отката",
  level_confirmed: "уровень подтверждён после БСУ",
};

export function signalLabel(key: string): string {
  return SIGNAL_LABELS[key] ?? key;
}
