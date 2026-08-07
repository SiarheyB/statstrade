import { prisma } from "./db";
import { Cache } from "./cache";
import {
  parseRiskProfile,
  riskPerTradeAmount,
  defaultRiskProfile,
  periodStart,
  periodEnd,
} from "./risk";

type Limits = {
  dailyStops?: number;
  weeklyStops?: number;
  monthlyStops?: number;
  yearlyStops?: number;
};

type Period = "day" | "week" | "month" | "year";

/**
 * Основная проверка перед отправкой стоп‑ордера.
 * Выбрасывает ошибку, если лимит уже достигнут.
 */
export async function checkRiskLimits(
  userId: string,
  exchangeId: string,
  orderType: "stop" | "limit" | "market"
) {
  if (orderType !== "stop") return; // ограничения только на стоп‑ордера

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true }, // We just need to check if user exists
  });

  if (!user) return;

  // Get risk profile for this user and exchange (empty string = default profile)
  const riskProfileRecord = await prisma.riskProfile.findFirst({
    where: {
      userId,
      accountId: exchangeId, // "" means default profile
    },
    select: {
      enabled: true,
      maxStopsPerDay: true,
      riskPerTrade: true,
      lossLimits: true,
    },
  });

  const profile = riskProfileRecord
    ? parseRiskProfile({
        enabled: riskProfileRecord.enabled,
        maxStopsPerDay: riskProfileRecord.maxStopsPerDay,
        riskPerTrade: riskProfileRecord.riskPerTrade,
        lossLimits: riskProfileRecord.lossLimits,
      })
    : defaultRiskProfile();

  const lossLimits = riskProfileRecord?.lossLimits
    ? JSON.parse(riskProfileRecord.lossLimits)
    : {};

  if (!profile || !profile.enabled) return; // профиль риска не включён – пропускаем

  const limits: Limits = {
    dailyStops: lossLimits.day?.on ? (Number.isFinite(parseFloat(String(lossLimits.day.value))) ? parseFloat(String(lossLimits.day.value)) : undefined) : undefined,
    weeklyStops: lossLimits.week?.on ? (Number.isFinite(parseFloat(String(lossLimits.week.value))) ? parseFloat(String(lossLimits.week.value)) : undefined) : undefined,
    monthlyStops: lossLimits.month?.on ? (Number.isFinite(parseFloat(String(lossLimits.month.value))) ? parseFloat(String(lossLimits.month.value)) : undefined) : undefined,
    yearlyStops: lossLimits.year?.on ? (Number.isFinite(parseFloat(String(lossLimits.year.value))) ? parseFloat(String(lossLimits.year.value)) : undefined) : undefined,
  };

  const [
    day,
    week,
    month,
    year,
  ] = await Promise.all([
    getNetStopsCount(userId, exchangeId, "day"),
    getNetStopsCount(userId, exchangeId, "week"),
    getNetStopsCount(userId, exchangeId, "month"),
    getNetStopsCount(userId, exchangeId, "year"),
  ]);

  if (limits.dailyStops && day >= limits.dailyStops) {
    throw new Error(`Дневной лимит стоп‑ордеров (${limits.dailyStops}) уже достигнут`);
  }
  if (limits.weeklyStops && week >= limits.weeklyStops) {
    throw new Error(`Недельный лимит стоп‑ордеров (${limits.weeklyStops}) уже достигнут`);
  }
  if (limits.monthlyStops && month >= limits.monthlyStops) {
    throw new Error(`Месячный лимит стоп‑ордеров (${limits.monthlyStops}) уже достигнут`);
  }
  if (limits.yearlyStops && year >= limits.yearlyStops) {
    throw new Error(`Годовой лимит стоп‑ордеров (${limits.yearlyStops}) уже достигнут`);
  }
}

/**
 * Возвращает **чистое** количество «использованных R» за период.
 * Считается так же, как в computeAccountRisk:
 *   netR = Σ (netPnl / rAmount)
 *   used = ceil( -netR - 1e‑9 )
 */
export async function getNetStopsCount(
  userId: string,
  exchangeId: string,
  period: Period
): Promise<number> {
  const cacheKey = `netStops:${userId}:${exchangeId}:${period}`;
  const cached = Cache.get<number>(cacheKey);
  if (cached !== undefined) return cached;

  // Границы периода берём из lib/risk.ts (одна реализация на весь риск-модуль).
  // Локальная копия этой логики отсчитывала "year" от начала МЕСЯЦА — годовой
  // лимит фактически совпадал с месячным.
  const now = new Date();
  const from = new Date(periodStart(period, now));

  // Получаем **все** закрытые сделки за период, сначала находим аккаунт пользователя
  const tradeAccount = await prisma.exchangeAccount.findFirst({
    where: {
      id: exchangeId,
      userId,
    },
    select: { id: true },
  });

  if (!tradeAccount) return 0;

  // Суммарный P&L за период — одним агрегатом по дневным сводкам
  // (TradeDaily, см. lib/analytics/daily.ts). Раньше сюда тянулись ВСЕ сделки
  // за период и складывались в Node. Результат тот же: границы периодов идут
  // по границам суток UTC, ровно по ним же нарезан TradeDaily.
  const totals = await prisma.tradeDaily.aggregate({
    where: {
      accountId: tradeAccount.id,
      day: { gte: from },
    },
    _sum: { netPnl: true },
  });
  const periodNetPnl = totals._sum.netPnl ?? 0;

  // Получаем профиль риска пользователя (из таблицы RiskProfile)
  const riskProfileRecord = await prisma.riskProfile.findFirst({
    where: {
      userId,
      accountId: exchangeId,
    },
    select: {
      enabled: true,
      maxStopsPerDay: true,
      riskPerTrade: true,
      lossLimits: true,
    },
  });
  const profile = riskProfileRecord
    ? parseRiskProfile({
        enabled: riskProfileRecord.enabled,
        maxStopsPerDay: riskProfileRecord.maxStopsPerDay,
        riskPerTrade: riskProfileRecord.riskPerTrade,
        lossLimits: riskProfileRecord.lossLimits,
      })
    : defaultRiskProfile();

  // Получаем баланс аккаунта для расчёта R‑value, если нужно процентное значение
  const account = await prisma.exchangeAccount.findUnique({
    where: { id: exchangeId },
    select: { balance: true, capital: true },
  });
  const balance = account?.capital ?? account?.balance ?? null;

  const rAmount = riskPerTradeAmount(profile, balance);
  // Если R‑value не задан (0 или null), считаем, что ограничений нет
  if (!rAmount || rAmount <= 0) {
    Cache.set(cacheKey, 0, 0);
    return 0;
  }

  // netPnl уже в валюте; делим на стоимость 1R, получаем R‑мультипликатор.
  // Σ(netPnl)/rAmount == Σ(netPnl/rAmount), поэтому деление одной суммы даёт
  // ровно то же, что прежний поштучный проход по сделкам.
  const netR = periodNetPnl / rAmount;

  // Чистое «затраченные» стопы (отрицательный netR → положительное количество)
  let used = 0;
  if (netR < 0) {
    used = Math.max(0, Math.ceil(-netR - 1e-9));
  }

  // TTL: оставшееся время до конца периода (тот же периодный календарь, что и
  // в periodStart — прошлая копия для "week" в воскресенье уезжала на 8 дней
  // вперёд, а для "year" держала значение почти год).
  const ttlMs = periodEnd(period, now) - now.getTime();

  Cache.set(cacheKey, used, ttlMs);
  return used;
}

/**
 * Pure function to calculate net stops used from an array of trades.
 * Exported for unit testing.
 * @param trades Array of { netPnl: number, result: "loss" | "win" | "breakeven" }
 * @param rAmount The monetary value of 1R (risk per trade). If <= 0, returns 0.
 * @returns Number of stops used (non‑negative integer)
 */
export function calculateNetStopsFromTrades(
  trades: { netPnl: number; result: "loss" | "win" | "breakeven" }[],
  rAmount: number
): number {
  if (!rAmount || rAmount <= 0) return 0;
  let netR = 0;
  for (const t of trades) {
    netR += t.netPnl / rAmount;
  }
  return netR < 0 ? Math.max(0, Math.ceil(-netR - 1e-9)) : 0;
}