// Базовые метрики портфеля для <PortfolioDashboard> (раздел 9): winrate,
// средний R, макс. просадка, упрощённый Sharpe. Спека не даёт точную формулу
// "упрощённого" Sharpe — ADJUSTED FROM SPEC: среднее R-мультипликаторов,
// делённое на их стандартное отклонение (стандартная retail-эвристика,
// минимальная сложность реализации, раздел 0 п.6 спеки разрешает такой выбор).
import type { JournalEntry } from "@/engine/entities/types";

export interface PortfolioMetrics {
  totalTrades: number;
  winRate: number | null; // доля прибыльных сделок, 0..1
  avgRMultiple: number | null;
  maxDrawdownPct: number | null; // 0..100
  simplifiedSharpe: number | null;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * startingBalance — баланс ДО первой сделки в journal (нужен, чтобы
 * восстановить кривую эквити из последовательности pnl и посчитать
 * просадку в процентах, а не в абсолютных деньгах).
 */
export function calculatePortfolioMetrics(journal: JournalEntry[], startingBalance: number): PortfolioMetrics {
  if (journal.length === 0) {
    return { totalTrades: 0, winRate: null, avgRMultiple: null, maxDrawdownPct: null, simplifiedSharpe: null };
  }
  const sorted = [...journal].sort((a, b) => a.timestampClosed - b.timestampClosed);
  const wins = sorted.filter((e) => e.pnl > 0).length;
  const rMultiples = sorted.map((e) => e.rMultiple).filter((r) => Number.isFinite(r));

  let equity = startingBalance;
  let peak = startingBalance;
  let maxDrawdownPct = 0;
  for (const entry of sorted) {
    equity += entry.pnl;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / peak) * 100);
  }

  const avgR = rMultiples.length > 0 ? mean(rMultiples) : null;
  const sd = rMultiples.length > 0 ? stdev(rMultiples, avgR ?? 0) : 0;

  return {
    totalTrades: sorted.length,
    winRate: wins / sorted.length,
    avgRMultiple: avgR,
    maxDrawdownPct,
    simplifiedSharpe: avgR != null && sd > 0 ? avgR / sd : null,
  };
}
