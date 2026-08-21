// Risk-manager domain: limit configuration, parsing, and status computation.
// Monitoring/alerting only — it never blocks trades on the exchange.

import {
  PERIODS,
  sumInPeriod,
  type PeriodKey,
  type HourBucket,
} from "./analytics/periods";

// Периодный календарь живёт в analytics/periods.ts (он же обслуживает
// «Календарь» и агрегаты). Ре-экспорт — чтобы не переписывать импортёров.
export { PERIODS, periodStart, periodEnd, type PeriodKey } from "./analytics/periods";

export type LossUnit = "pct" | "amount";

export type PeriodLimit = { on: boolean; value: number; unit: LossUnit };
export type LossLimits = Record<PeriodKey, PeriodLimit>;

export type RiskProfileData = {
  enabled: boolean;
  maxStopsPerDay: number | null;
  riskPerTrade: PeriodLimit; // risk per trade (1R) used for the R-multiple column
  lossLimits: LossLimits;
};

const emptyLimit = (): PeriodLimit => ({ on: false, value: 0, unit: "pct" });

export function defaultRiskProfile(): RiskProfileData {
  return {
    enabled: false,
    maxStopsPerDay: null,
    riskPerTrade: emptyLimit(),
    lossLimits: { day: emptyLimit(), week: emptyLimit(), month: emptyLimit(), year: emptyLimit() },
  };
}

// Tolerantly parse a stored profile (DB row fields) into RiskProfileData.
export function parseRiskProfile(row: {
  enabled?: boolean;
  maxStopsPerDay?: number | null;
  riskPerTrade?: string | null;
  lossLimits?: string | null;
} | null): RiskProfileData {
  const base = defaultRiskProfile();
  if (!row) return base;
  base.enabled = !!row.enabled;
  base.maxStopsPerDay =
    typeof row.maxStopsPerDay === "number" && row.maxStopsPerDay > 0 ? row.maxStopsPerDay : null;
  if (row.riskPerTrade) {
    try {
      const r = JSON.parse(row.riskPerTrade) as Partial<PeriodLimit>;
      base.riskPerTrade = {
        on: !!r.on,
        value: Number.isFinite(Number(r.value)) ? Number(r.value) : 0,
        unit: r.unit === "amount" ? "amount" : "pct",
      };
    } catch {
      // keep default
    }
  }
  if (row.lossLimits) {
    try {
      const raw = JSON.parse(row.lossLimits) as Partial<Record<PeriodKey, Partial<PeriodLimit>>>;
      for (const p of PERIODS) {
        const l = raw[p];
        if (l) {
          base.lossLimits[p] = {
            on: !!l.on,
            value: Number.isFinite(Number(l.value)) ? Number(l.value) : 0,
            unit: l.unit === "amount" ? "amount" : "pct",
          };
        }
      }
    } catch {
      // keep defaults
    }
  }
  return base;
}

export function serializeLossLimits(limits: LossLimits): string {
  return JSON.stringify(limits);
}

export function serializeRiskPerTrade(limit: PeriodLimit): string {
  return JSON.stringify(limit);
}

// The money risk of one trade (1R) for the given profile, or null when it can't
// be determined (disabled, not set, or a % unit without a known balance).
export function riskPerTradeAmount(
  profile: RiskProfileData,
  balance: number | null,
): number | null {
  const r = profile.riskPerTrade;
  if (!profile.enabled || !r.on || r.value <= 0) return null;
  if (r.unit === "amount") return r.value;
  if (balance == null || balance <= 0) return null;
  return (balance * r.value) / 100;
}

// --- R-multiple (RR) — shared by /dashboard/trades and /dashboard/calendar
// so both show the same number for the same trade. ---

export type RRTradeInput = {
  accountId: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  fees: number;
  qty: number;
  netPnl: number;
};

// Stop-loss-distance model: 1R = |entry - stop| price move, fees expressed in
// the same R units. Used when no risk-manager profile overrides it.
//
// Считаем ровно по тому стопу, что стоит в колонке «Стоп», без попыток
// угадать «настоящий» риск. Отдельно стоит помнить, что форекс-отчёты MT4/MT5
// отдают S/L НА МОМЕНТ ЗАКРЫТИЯ: если стоп был подтянут в безубыток, в колонку
// попадёт он, и R получится огромным (XAUUSD: вход 4594.21, стоп 4594.25,
// выход 4582.73 → +286.98R). Это не ошибка расчёта — в поле «Стоп» у сделки
// можно вписать тот стоп, с которым входили, и R пересчитается.
//
// Пустой стоп или стоп ровно в точке входа → R нет (делить не на что).
export function stopDistanceRR(tr: RRTradeInput, stopLoss: number | null): number | null {
  if (stopLoss == null) return null;
  const oneR = Math.abs(tr.entryPrice - stopLoss);
  if (oneR <= 0) return null;
  const priceMove = tr.side === "long" ? tr.exitPrice - tr.entryPrice : tr.entryPrice - tr.exitPrice;
  const grossR = priceMove / oneR;
  const feeR = tr.fees / (oneR * tr.qty);
  return grossR - feeR;
}

// R-multiple for a trade: if the risk manager is enabled for this account with
// a configured per-trade risk, R = netPnl / (that money amount) — otherwise
// falls back to the stop-loss-distance model above.
export function tradeRR(
  tr: RRTradeInput,
  stopLoss: number | null,
  riskProfiles: Record<string, RiskProfileData>,
  balance: number | null,
): number | null {
  const prof = riskProfiles[tr.accountId] ?? riskProfiles[""];
  if (prof) {
    const riskAmt = riskPerTradeAmount(prof, balance);
    if (riskAmt && riskAmt > 0) return tr.netPnl / riskAmt;
  }
  return stopDistanceRR(tr, stopLoss);
}

// --- Status computation ---

// Статус риска считается из почасового агрегата (TradeHourly). Раньше сюда
// приходил список ВСЕХ сделок за окно и складывался в Node; теперь суммирование
// сделано один раз при изменении сделок (lib/analytics/hourly.ts), а границы
// окон берутся в таймзоне пользователя (lib/analytics/periods.ts).
export type { HourBucket } from "./analytics/periods";

export type LimitState = "ok" | "warning" | "breached";
export type LimitStatus = {
  key: "stops" | PeriodKey;
  unit: "count" | "amount";
  used: number;
  limit: number;
  pct: number; // 0..1+
  state: LimitState;
};
export type AccountRisk = {
  accountId: string;
  enabled: boolean;
  balance: number | null;
  state: "off" | LimitState;
  limits: LimitStatus[];
};

const WARN_RATIO = 0.8;

// Net loss within a period: sum of ALL trades' P&L (wins offset losses).
// Consistent with getNetStopsCount() and the "stops" day-counter — a +3R
// take-profit offsets −3R of losses, showing the net drawdown.
// Суммирует почасовые агрегаты; границы периода — в таймзоне пользователя.
function lossInPeriod(
  hours: HourBucket[],
  key: PeriodKey,
  now: Date,
  offsetMinutes: number,
): number {
  const net = sumInPeriod(hours, key, now, offsetMinutes).netPnl;
  return net < 0 ? -net : 0;
}

function stateFor(used: number, limit: number): LimitState {
  if (limit <= 0) return "ok";
  if (used >= limit) return "breached";
  if (used >= limit * WARN_RATIO) return "warning";
  return "ok";
}

const worse = (a: LimitState, b: LimitState): LimitState => {
  const rank = { ok: 0, warning: 1, breached: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
};

export function computeAccountRisk(
  accountId: string,
  hours: HourBucket[],
  balance: number | null,
  profile: RiskProfileData,
  offsetMinutes: number,
  now: Date = new Date(),
): AccountRisk {
  if (!profile.enabled) {
    return { accountId, enabled: false, balance, state: "off", limits: [] };
  }

  const limits: LimitStatus[] = [];

  // Stops today — NET of take-profits. A win offsets prior stops by its size:
  // if 1R (risk-per-trade) is configured, we sum today's R-multiples (loss = −1R,
  // a +3R take cancels 3 stops), and "used" is the net drawdown in R (a net
  // profit shows 0 stops used). Without a 1R setting we fall back to a 1:1 net
  // count (losses − wins). This is what the trader means by "учитывать стопы и
  // тейки": two stops then one take should not trip the limit.
  //
  // «Сегодня» — локальные сутки пользователя, а не UTC.
  if (profile.maxStopsPerDay && profile.maxStopsPerDay > 0) {
    const today = sumInPeriod(hours, "day", now, offsetMinutes);
    const rAmount = riskPerTradeAmount(profile, balance);

    let used: number;
    if (rAmount && rAmount > 0) {
      // Net drawdown in R: losses add, wins subtract (by their R-multiple).
      // Σ(netPnl)/rAmount == Σ(netPnl/rAmount) — агрегат даёт то же число, что
      // поштучный проход по сделкам.
      used = -(today.netPnl / rAmount);
    } else {
      // No 1R configured → net count: each stop +1, each take −1.
      // Безубыточные сделки не в счёт — их нет ни в wins, ни в losses.
      used = today.losses - today.wins;
    }
    // Стопы — счётчик, показываем целыми и консервативно: частично «съеденный»
    // стоп (0.96R) считается использованным целиком. Эпсилон — чтобы ровные
    // значения (3.0000001 из-за float) не округлялись лишний раз вверх.
    // В плюсе → 0 использованных стопов, никогда не отрицательно.
    used = Math.max(0, Math.ceil(used - 1e-9));

    limits.push({
      key: "stops",
      unit: "count",
      used,
      limit: profile.maxStopsPerDay,
      pct: used / profile.maxStopsPerDay,
      state: stateFor(used, profile.maxStopsPerDay),
    });
  }

  // Loss limits per period.
  for (const p of PERIODS) {
    const cfg = profile.lossLimits[p];
    if (!cfg.on || cfg.value <= 0) continue;
    let limitAmount: number;
    if (cfg.unit === "pct") {
      if (!balance || balance <= 0) continue; // can't evaluate % without a balance
      limitAmount = (balance * cfg.value) / 100;
    } else {
      limitAmount = cfg.value;
    }
    const used = lossInPeriod(hours, p, now, offsetMinutes);
    limits.push({
      key: p,
      unit: "amount",
      used,
      limit: limitAmount,
      pct: limitAmount > 0 ? used / limitAmount : 0,
      state: stateFor(used, limitAmount),
    });
  }

  const state = limits.reduce<LimitState>((acc, l) => worse(acc, l.state), "ok");
  return { accountId, enabled: true, balance, state, limits };
}
