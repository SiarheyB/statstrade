// Переключение на резервный источник и обратно.
//
// Вынесено из index.mjs отдельным модулем ради проверяемости: это самая
// рискованная часть коллектора (автоматическая смена источника данных под
// нагрузкой), а в index.mjs её не протестировать — там при импорте поднимается
// пул Postgres и стартует опрос.

/**
 * Закрыт ли валютный рынок (UTC).
 *
 * Границы те же, что у isForexMarketClosed в приложении
 * (src/lib/forexMarket.ts). Общий модуль подключить нельзя: коллектор — отдельный
 * сервис со своим package.json, он не видит src/.
 */
export function isMarketClosed(nowMs) {
  const d = new Date(nowMs);
  const day = d.getUTCDay(); // 0 = воскресенье
  const hour = d.getUTCHours();

  if (day === 6) return true; // суббота целиком
  if (day === 5 && hour >= 21) return true; // пятница после закрытия
  if (day === 0 && hour < 22) return true; // воскресенье до открытия
  return false;
}

/**
 * Счётчик неудачных циклов опроса, который решает, поднимать ли резерв.
 *
 * @param {object} opts
 * @param {number} opts.failCycles сколько полностью неудачных циклов подряд включают резерв
 * @param {() => void} opts.onEnable  вызывается один раз при переходе в резерв
 * @param {() => void} opts.onDisable вызывается один раз при возврате к основному источнику
 */
export function createFallbackController({ failCycles, onEnable, onDisable }) {
  let failStreak = 0;
  let active = false;

  const apply = () => {
    const next = failStreak >= failCycles;
    if (next === active) return;
    active = next;
    if (active) onEnable?.();
    else onDisable?.();
  };

  return {
    get active() { return active; },
    get failStreak() { return failStreak; },

    /**
     * Итог одного цикла опроса.
     *
     * Цикл считается провальным, только если не прошёл НИ ОДИН запрос:
     * единичный 503 по одному инструменту — обычное дело, менять из-за него
     * источник нельзя.
     *
     * На закрытом рынке счётчик не двигается вообще: резерв нужен, чтобы не
     * терять живые данные, а на выходных их нет ни у одного источника — там
     * переключение только зря поднимало бы соединение.
     */
    recordCycle({ attempts, failures, marketClosed = false }) {
      if (marketClosed || attempts === 0) return;
      if (failures === attempts) failStreak++;
      else if (failures === 0) failStreak = 0;
      apply();
    },

    /** Принудительно вернуться к основному источнику (например, раздел выключили). */
    reset() {
      failStreak = 0;
      apply();
    },
  };
}
