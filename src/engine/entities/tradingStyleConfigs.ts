// Конфиги стилей торговли — раздел 5 спеки. Данные для ВСЕХ 9 стилей
// записаны сразу (дёшево, разблокирует поздние фазы без переделок), но в
// Фазе 1 движок реально использует только "day" — remaining стили не
// выбираемы в UI и не обрабатываются gameLoop, пока не подключены
// соответствующие фазы (2, 6).
//
// minHoldTimeMs — в игровых мс. timeAcceleration — множитель игрового
// времени к реальному (dtGame = dtReal * timeAcceleration).
import type { TradingStyle, TradingStyleConfig } from "./types";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export const TRADING_STYLE_CONFIGS: Record<TradingStyle, TradingStyleConfig> = {
  scalping: {
    style: "scalping",
    minHoldTimeMs: 5 * SEC,
    timeAcceleration: 1,
    maxLeverage: 20,
    commissionRate: 0.0005,
    spreadMultiplier: 1.5,
    unlockRequirement: {},
  },
  day: {
    style: "day",
    minHoldTimeMs: 1 * MIN,
    timeAcceleration: 60,
    maxLeverage: 10,
    commissionRate: 0.0008,
    spreadMultiplier: 1.0,
    // Фаза 1 стартует игрока сразу в day-режиме через онбординг (раздел 22) —
    // это требование НЕ проверяется, пока не подключена прогрессия (Фаза 4).
    unlockRequirement: {},
  },
  swing: {
    style: "swing",
    minHoldTimeMs: 1 * HOUR,
    timeAcceleration: 720,
    maxLeverage: 5,
    commissionRate: 0.001,
    spreadMultiplier: 0.8,
    unlockRequirement: { minSkillLevel: { day: 3 } },
  },
  position: {
    style: "position",
    minHoldTimeMs: 1 * DAY,
    timeAcceleration: 4320,
    maxLeverage: 3,
    commissionRate: 0.0012,
    spreadMultiplier: 0.6,
    unlockRequirement: { minAccountBalance: 5000, minSkillLevel: { swing: 3 } },
  },
  investing: {
    style: "investing",
    minHoldTimeMs: 1 * WEEK,
    timeAcceleration: 43200,
    maxLeverage: 1,
    commissionRate: 0.0015,
    spreadMultiplier: 0.5,
    unlockRequirement: {},
  },
  algo: {
    style: "algo",
    // "зависит от стратегии бота" (спека) — плейсхолдер до Фазы 6.
    minHoldTimeMs: 0,
    timeAcceleration: 1,
    maxLeverage: 10,
    commissionRate: 0.0005,
    spreadMultiplier: 1.0,
    unlockRequirement: { minSkillLevel: {}, requiredLicense: "Quant" },
  },
  arbitrage: {
    style: "arbitrage",
    minHoldTimeMs: 1 * SEC,
    timeAcceleration: 1,
    maxLeverage: 5,
    commissionRate: 0.0003,
    spreadMultiplier: 0.3,
    unlockRequirement: { minAccountBalance: 20000, requiredLicense: "Arbitrage" },
  },
  market_making: {
    style: "market_making",
    minHoldTimeMs: 0,
    timeAcceleration: 1,
    maxLeverage: 3,
    // "получает спред вместо платит" (спека) — знак/механика считаются в Фазе 6.
    commissionRate: 0,
    spreadMultiplier: 0,
    unlockRequirement: { minAccountBalance: 50000 },
  },
  options: {
    style: "options",
    // "1 час - недели, зависит от экспирации" — плейсхолдер до Фазы 6.
    minHoldTimeMs: 1 * HOUR,
    timeAcceleration: 1,
    maxLeverage: 1,
    commissionRate: 0.002, // от премии, не от номинала — пересчитывается в Фазе 6
    spreadMultiplier: 0,
    unlockRequirement: { minSkillLevel: { position: 5, swing: 5 }, requiredLicense: "Derivatives" },
  },
};
