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
  lossLimits: LossLimits;
};

const emptyLimit = (): PeriodLimit => ({ on: false, value: 0, unit: "pct" });

export function defaultRiskProfile(): RiskProfileData {
  return {
    enabled: false,
    maxStopsPerDay: null,
    lossLimits: { day: emptyLimit(), week: emptyLimit(), month: emptyLimit(), year: emptyLimit() },
  };
}

// Tolerantly parse a stored profile (DB row fields) into RiskProfileData.
export function parseRiskProfile(row: {
  enabled?: boolean;
  maxStopsPerDay?: number | null;
  lossLimits?: string | null;
} | null): RiskProfileData {
  const base = defaultRiskProfile();
  if (!row) return base;
  base.enabled = !!row.enabled;
  base.maxStopsPerDay =
    typeof row.maxStopsPerDay === "number" && row.maxStopsPerDay > 0 ? row.maxStopsPerDay : null;
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

// Realized loss (positive number) within a period: the sum of losing trades'
// P&L — the same "stops" the day-counter sees, not the net of wins and losses.
// Winning trades must NOT mask the losses already taken (a daily/weekly loss
// limit tracks how much was lost, regardless of offsetting profits).
function lossInPeriod(trades: RiskTrade[], key: PeriodKey, now: Date): number {
  const start = periodStart(key, now);
  let loss = 0;
  for (const t of trades) {
    if (t.exitTime.getTime() >= start && t.netPnl < 0) loss += -t.netPnl;
  }
  return loss;
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

  // Stops today (losing trades closed today).
  if (profile.maxStopsPerDay && profile.maxStopsPerDay > 0) {
    const dayStart = periodStart("day", now);
    const stops = trades.filter(
      (t) => t.exitTime.getTime() >= dayStart && t.result === "loss",
    ).length;
    limits.push({
      key: "stops",
      unit: "count",
      used: stops,
      limit: profile.maxStopsPerDay,
      pct: stops / profile.maxStopsPerDay,
      state: stateFor(stops, profile.maxStopsPerDay),
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
