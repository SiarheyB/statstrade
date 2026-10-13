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

// Требуется ли комментарий «почему» при переходе с риска prev на next.
//
// Спрашиваем ровно про то, что человек решает сам: УВЕЛИЧЕНИЕ или УМЕНЬШЕНИЕ
// риска. Поэтому сравниваются НАСТРОЙКИ (процент/сумма), а не 1R в деньгах:
// 1R считается от капитала и переезжает сам при каждом движении баланса — лови
// мы его, приложение требовало бы объяснений за правку, которой не было.
//
// Первая настройка риска (его не было) и выключение комментария не требуют:
// это не «поменял риск», а «завёл» и «отключил». Смена единицы (% ↔ $) —
// требует: 1R от неё меняется так же, как от величины.
export function riskChangeNeedsComment(prev: PeriodLimit, next: PeriodLimit): boolean {
  const prevOn = prev.on && prev.value > 0;
  const nextOn = next.on && next.value > 0;
  if (!prevOn || !nextOn) return false;
  return prev.value !== next.value || prev.unit !== next.unit;
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
  // Комиссия переводится в R через объём, и при нулевом объёме это деление на
  // ноль: feeR = Infinity, а R сделки — −Infinity. Такое значение не просто
  // бессмысленно само по себе, оно отравляет любую агрегатную статистику
  // (средний R, ожидание, кривая R) — одна строка делает весь столбец
  // бесконечным.
  //
  // Объём может оказаться нулевым по вполне земной причине: у частично
  // закрытой позиции MT5 в отчёте пишет 0, и такая сделка попадала в журнал
  // с −InfinityR (замечено на живом счёте, GBPCAD). Считаем, что комиссию в
  // R выразить нечем, и отдаём чистое движение цены — это честнее, чем
  // бесконечность, и не мешает сделке обновиться при следующем импорте.
  const feeBase = oneR * tr.qty;
  const feeR = feeBase > 0 ? tr.fees / feeBase : 0;
  return grossR - feeR;
}

// Ручной риск сделки — 1R для ЭТОЙ сделки, заданный руками в её карточке.
//
// Полей два, и они НЕ пересчитываются друг из друга, потому что отвечают на
// разные вопросы:
//   riskPct    — ПЛАН: сколько процентов капитала трейдер готов был потерять.
//                Он и есть 1R: план не зависит от того, как лёг набор объёма.
//   riskAmount — ФАКТ: сколько денег реально заложено в стоп по набранному
//                объёму. Почти всегда чуть меньше плана (объём набирается
//                лотами, точно в 1% не попасть), и именно поэтому стоп даёт
//                не ровно −1R, а, скажем, −0.97R; комиссия и своп добавляют
//                сверху и доводят до −1.03R. Считать по нему 1R значило бы
//                объявлять любой недобор объёма «ровно одним риском» и терять
//                как раз то отклонение, ради которого поле и заведено.
//
// Поэтому знаменатель R — план, а факт в формулу не входит вовсе: числитель
// (netPnl от брокера) уже содержит и недобор объёма, и комиссию, и своп.
// Факт нужен, чтобы ПОКАЗАТЬ отклонение (см. plannedVsActual в карточке).
//
// Фактическая сумма берётся знаменателем ровно в одном случае — когда плана
// нет (процент не введён или баланс счёта неизвестен, и развернуть процент в
// деньги не во что). Тогда это единственное число про риск, что у нас есть.
export function manualRiskAmount(
  riskAmount: number | null | undefined,
  riskPct: number | null | undefined,
  balance: number | null,
): number | null {
  if (riskPct != null && riskPct > 0 && balance != null && balance > 0) {
    return (balance * riskPct) / 100;
  }
  if (riskAmount != null && riskAmount > 0) return riskAmount;
  return null;
}

// Плановый 1R в деньгах — сколько ДОЛЖНО было быть заложено в стоп по проценту
// от капитала. Отдельно от manualRiskAmount: тому важно отдать хоть какое-то
// число для R, а здесь нужен именно план, и его отсутствие — значимый ответ
// (сравнивать факт не с чем).
export function plannedRiskAmount(
  riskPct: number | null | undefined,
  balance: number | null,
): number | null {
  if (riskPct == null || riskPct <= 0) return null;
  if (balance == null || balance <= 0) return null;
  return (balance * riskPct) / 100;
}

// Фактически заложенные в стоп деньги, посчитанные из самой сделки — чтобы
// руками вводить только план (процент), а факт подставлялся сам.
//
// Напрашивается считать его из лотов: |вход − стоп| × лоты × размер контракта.
// Но это даёт деньги в ВАЛЮТЕ КОТИРОВКИ, а счёт ведётся в своей (USDCHF на
// долларовом счёте — франки), и пришлось бы тащить курс на момент закрытия,
// которого у нас нет. Курс, однако, уже зашит в саму сделку: брокер посчитал
// gross P&L в валюте счёта за известное движение цены. Отсюда
//
//   риск = |вход − стоп| × объём × курс,  |gross| = |выход − вход| × объём × курс
//   ⇒ риск = |gross| × |вход − стоп| / |выход − вход|
//
// — ни объёма, ни размера контракта, ни курса. Работает одинаково для форекса
// и крипты, а у объединённой сетки средние взвешены по лотам, так что и там
// пропорция верна.
//
// Оценка остаётся ОЦЕНКОЙ: стоп в отчёте MT4/MT5 — это S/L НА МОМЕНТ ЗАКРЫТИЯ,
// и если его подтянули в безубыток, посчитанный «факт» будет неправдой. Лечится
// тем же способом, что и RR по стопу: вписать в «Стоп» тот, с которым входили,
// либо вписать сумму руками — ручной ввод всегда главнее расчёта.
//
// Движения цены нет (выход ровно по входу) или брокер отдал нулевой gross —
// пропорцию строить не из чего, и это честный null, а не ноль.
export function impliedStopRisk(tr: {
  entryPrice: number;
  exitPrice: number;
  grossPnl: number;
  stopLoss: number | null;
}): number | null {
  if (tr.stopLoss == null) return null;
  const stopDist = Math.abs(tr.entryPrice - tr.stopLoss);
  const moved = Math.abs(tr.exitPrice - tr.entryPrice);
  if (stopDist <= 0 || moved <= 0) return null;
  const risk = (Math.abs(tr.grossPnl) * stopDist) / moved;
  return Number.isFinite(risk) && risk > 0 ? risk : null;
}

// Каким был бы R, если бы сделка закрылась по стопу: фактически заложенная
// сумма плюс комиссия и своп, делённые на плановый 1R. Это та самая оценка
// «−1.03R вместо −1R», которую не видно до закрытия сделки. Своп складывается,
// а не вычитается: у брокера он уже со знаком (netPnl = gross + swap − комиссия).
export function stopRMultiple(
  args: { riskAmount: number | null; plannedR: number | null; fees: number; swap: number },
): number | null {
  const { riskAmount, plannedR, fees, swap } = args;
  if (riskAmount == null || riskAmount <= 0) return null;
  if (plannedR == null || plannedR <= 0) return null;
  return (-riskAmount + swap - fees) / plannedR;
}

// R-multiple for a trade: if the risk manager is enabled for this account with
// a configured per-trade risk, R = netPnl / (that money amount) — otherwise
// falls back to the stop-loss-distance model above.
// `riskAmountOverride` — стоимость 1R, действовавшая на МОМЕНТ ЗАКРЫТИЯ сделки
// (lib/riskHistory.ts). Передан — берётся он, а не текущий профиль: иначе смена
// риска в настройках переписывала бы R у всей истории. `undefined` = истории
// нет, считаем по профилю как раньше; `null` = тогда 1R не был задан, и это
// осознанный ответ, а не повод подставить сегодняшний риск.
export function tradeRR(
  tr: RRTradeInput,
  stopLoss: number | null,
  riskProfiles: Record<string, RiskProfileData>,
  balance: number | null,
  riskAmountOverride?: number | null,
  manualRisk?: number | null,
): number | null {
  // Ручной риск сделки важнее всего остального: человек прямо сказал, каким
  // был 1R в ЭТОЙ сделке, и спорить с ним ни профилю (там риск один на весь
  // счёт), ни стопу из отчёта брокера (который к закрытию мог быть подтянут
  // в безубыток) не с чем.
  if (manualRisk != null && manualRisk > 0) return tr.netPnl / manualRisk;
  if (riskAmountOverride !== undefined) {
    if (riskAmountOverride && riskAmountOverride > 0) return tr.netPnl / riskAmountOverride;
    return stopDistanceRR(tr, stopLoss);
  }
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
  // Только для key === "stops". `used` там — просадка в R, округлённая вверх,
  // а НЕ число стоп-сделок: одна сделка на −2.2R даёт used = 3. Читалось это как
  // «три стопа» и выглядело багом, поэтому рядом отдаём и то, и другое:
  //   netStops — чистый счёт сделок за сутки (убыточные минус прибыльные),
  //   usedR    — та самая просадка в R, без округления.
  netStops?: number;
  usedR?: number;
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
    const usedR = used;
    used = Math.max(0, Math.ceil(used - 1e-9));

    limits.push({
      key: "stops",
      unit: "count",
      used,
      limit: profile.maxStopsPerDay,
      pct: used / profile.maxStopsPerDay,
      state: stateFor(used, profile.maxStopsPerDay),
      // Сколько РЕАЛЬНО было стоп-сделок — чтобы баннер не выдавал просадку в R
      // за число сделок (одна сделка на −2.2R ≠ три стопа).
      netStops: Math.max(0, today.losses - today.wins),
      usedR: Math.max(0, usedR),
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
