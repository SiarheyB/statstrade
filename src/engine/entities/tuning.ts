// Настройки баланса игры, которые админ правит без передеплоя
// (/admin/game → FeatureConfig "game", см. src/lib/features.ts).
//
// Движок ОБЯЗАН работать и без сервера: тесты, первый кадр до того, как
// страница передала конфигурацию, и вообще любой вызов формулы напрямую.
// Поэтому здесь лежат те же значения по умолчанию, что и в реестре фич, а
// сервер лишь переопределяет их.
//
// В движке всё хранится в «нормальном» виде (доли, а не проценты): проценты
// удобны админу в форме, но в формуле умножать на 100 — источник ошибок.
export interface GameTuning {
  startingBalance: number;
  newsPerGameDay: number;
  /**
   * Разброс числа новостей, доля от базы: 0.5 — «от базы до полутора баз».
   *
   * Ровно N новостей каждый день — это расписание, а не новости: игрок за
   * неделю привыкает к ритму и перестаёт их читать. Настоящий поток
   * неровный, поэтому админ задаёт базу и разброс, а сколько выйдет
   * сегодня — решает день.
   */
  newsSpread: number;
  blackSwanWeight: number; // доля чёрных лебедей среди новостей (0.001 = 1 из 1000)
  volatilityMultiplier: number; // множитель к σ всех активов
  dividendMultiplier: number; // множитель к дивидендам/купонам
  upkeepMultiplier: number; // множитель к расходам на образ жизни
  xpMultiplier: number; // множитель к начисляемому опыту
  maxLeverageCap: number; // 0 = не ограничивать
  taxRatePct: number; // налог на зафиксированную прибыль, % (0 = выключить)
}

export const DEFAULT_TUNING: GameTuning = {
  startingBalance: 10_000,
  newsPerGameDay: 24,
  newsSpread: 0.3,
  blackSwanWeight: 0.001,
  volatilityMultiplier: 1,
  dividendMultiplier: 1,
  upkeepMultiplier: 1,
  xpMultiplier: 1,
  maxLeverageCap: 0,
  taxRatePct: 13,
};

/** Сырые числа из админки (проценты/промилле) → нормализованный GameTuning. */
export function tuningFromConfig(raw: Partial<Record<string, number>> | undefined): GameTuning {
  if (!raw) return DEFAULT_TUNING;
  const num = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const pct = (value: number | undefined, fallback: number) => Math.max(0, num(value, fallback * 100) / 100);
  return {
    startingBalance: Math.max(1, num(raw.startingBalance, DEFAULT_TUNING.startingBalance)),
    // Админка задаёт нижнюю границу и разброс — движок хранит их в том же
    // виде, в котором считает.
    newsPerGameDay: Math.max(0, num(raw.newsPerDay, DEFAULT_TUNING.newsPerGameDay)),
    newsSpread: Math.min(3, Math.max(0, num(raw.newsSpreadPct, DEFAULT_TUNING.newsSpread * 100) / 100)),
    blackSwanWeight: Math.min(0.5, Math.max(0, num(raw.blackSwanPerMille, 1) / 1000)),
    volatilityMultiplier: pct(raw.volatilityPct, DEFAULT_TUNING.volatilityMultiplier),
    dividendMultiplier: pct(raw.dividendPct, DEFAULT_TUNING.dividendMultiplier),
    upkeepMultiplier: pct(raw.upkeepPct, DEFAULT_TUNING.upkeepMultiplier),
    xpMultiplier: pct(raw.xpPct, DEFAULT_TUNING.xpMultiplier),
    maxLeverageCap: Math.max(0, num(raw.maxLeverageCap, DEFAULT_TUNING.maxLeverageCap)),
    taxRatePct: Math.max(0, Math.min(60, num(raw.taxRatePct, DEFAULT_TUNING.taxRatePct))),
  };
}
