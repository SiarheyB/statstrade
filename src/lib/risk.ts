// Risk-manager domain: limit configuration, parsing, and status computation.
// Monitoring/alerting only — it never blocks trades on the exchange.

export type LossUnit = "pct" | "amount";
export type PeriodKey = "day" | "week" | "month" | "year";
export const PERIODS: PeriodKey[] = ["day", "week", "month", "year"];

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

// --- Status computation ---

export type RiskTrade = { accountId: string; netPnl: number; exitTime: Date; result: string };

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

function periodStart(key: PeriodKey, now: Date): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  if (key === "day") return Date.UTC(y, m, d);
  if (key === "week") {
    const diff = (now.getUTCDay() + 6) % 7; // days since Monday
    return Date.UTC(y, m, d - diff);
  }
  if (key === "month") return Date.UTC(y, m, 1);
  return Date.UTC(y, 0, 1);
}

// Net loss within a period: sum of ALL trades' P&L (wins offset losses).
// Consistent with getNetStopsCount() and the "stops" day-counter — a +3R
// take-profit offsets −3R of losses, showing the net drawdown.
function lossInPeriod(trades: RiskTrade[], key: PeriodKey, now: Date): number {
  const start = periodStart(key, now);
  let net = 0;
  for (const t of trades) {
    if (t.exitTime.getTime() >= start) net += t.netPnl;
  }
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
  trades: RiskTrade[],
  balance: number | null,
  profile: RiskProfileData,
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
  if (profile.maxStopsPerDay && profile.maxStopsPerDay > 0) {
    const dayStart = periodStart("day", now);
    const today = trades.filter((t) => t.exitTime.getTime() >= dayStart);
    const rAmount = riskPerTradeAmount(profile, balance);

    let used: number;
    if (rAmount && rAmount > 0) {
      // Net drawdown in R: losses add, wins subtract (by their R-multiple).
      let netR = 0;
      for (const t of today) netR += t.netPnl / rAmount;
      used = -netR;
    } else {
      // No 1R configured → net count: each stop +1, each take −1.
      let net = 0;
      for (const t of today) {
        if (t.result === "loss") net += 1;
        else if (t.result === "win") net -= 1;
      }
      used = net;
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
    const used = lossInPeriod(trades, p, now);
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
