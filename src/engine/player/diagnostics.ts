// Разбор сделок: почему счёт растёт или не растёт.
//
// Журнал у игрока был с самого начала, метрики считались — но никто не
// говорил ему главного. «Винрейт 46%, средний R 0.2» — это отчёт, а не
// разбор: из него не следует, что делать завтра. А «прибыль вы держите
// вдвое меньше, чем убыток» — следует.
//
// Именно это отличает тренажёр от автомата и оправдывает место игры внутри
// TradeStats, где ровно тем же занимаются отчёты по реальным сделкам.
//
// Правила устроены одинаково: у каждого есть минимальная выборка, ниже
// которой оно молчит. Вывод, сделанный по трём сделкам, — это не вывод, а
// шум, и доверие к разбору он подрывает быстрее, чем что-либо другое.
import type { JournalEntry, Position } from "@/engine/entities/types";

export interface TradeInsight {
  /** Ключ правила — он же ключ перевода: game.insight.<id>. */
  id: string;
  tone: "warn" | "info" | "good";
  /** Подстановки в текст правила. */
  values: Record<string, string | number>;
}

// Пороги. Вынесены в константы не ради настройки, а чтобы их можно было
// прочитать и оспорить, не разбирая формулы.
export const MIN_TRADES = 10;
export const MIN_GROUP = 4;
/** Во сколько раз убыток должен держаться дольше прибыли, чтобы это назвать. */
export const HOLD_ASYMMETRY = 1.6;
/** Доля сделок без стопа, после которой об этом стоит сказать. */
export const NO_STOP_SHARE = 0.3;
/** Сколько минут после убытка считаются «на горячую». */
export const REVENGE_WINDOW_MS = 5 * 60_000;
/** Доля сделок в одном инструменте, после которой это уже не выбор, а привычка. */
export const CONCENTRATION_SHARE = 0.6;

interface Trade {
  position: Position;
  pnl: number;
  holdMs: number;
  win: boolean;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Закрытые сделки в удобном для правил виде, от старых к новым. */
export function collectTrades(positions: Position[]): Trade[] {
  return positions
    .filter((p) => p.closedAt != null && p.realizedPnl != null)
    .map((p) => ({
      position: p,
      pnl: p.realizedPnl!,
      holdMs: Math.max(0, p.closedAt! - p.openedAt),
      win: (p.realizedPnl ?? 0) > 0,
    }))
    .sort((a, b) => a.position.closedAt! - b.position.closedAt!);
}

/**
 * Разбор: список замечаний, самое важное первым.
 *
 * Возвращается не больше нескольких пунктов сразу — список из десяти
 * замечаний читается как «у тебя всё плохо» и не меняет поведения.
 */
export function diagnose(positions: Position[], journal: JournalEntry[], limit = 4): TradeInsight[] {
  const trades = collectTrades(positions);
  if (trades.length < MIN_TRADES) return [];

  const insights: TradeInsight[] = [];
  const wins = trades.filter((t) => t.win);
  const losses = trades.filter((t) => !t.win);

  // 1. Держим убыток дольше прибыли. Самая частая и самая дорогая привычка:
  // именно из неё получается «много мелких плюсов и один большой минус».
  if (wins.length >= MIN_GROUP && losses.length >= MIN_GROUP) {
    const winHold = mean(wins.map((t) => t.holdMs));
    const lossHold = mean(losses.map((t) => t.holdMs));
    if (winHold > 0 && lossHold / winHold >= HOLD_ASYMMETRY) {
      insights.push({
        id: "holdAsymmetry",
        tone: "warn",
        values: { ratio: (lossHold / winHold).toFixed(1) },
      });
    }
  }

  // 2. Выигрываем чаще, чем проигрываем, но всё равно в минусе — значит
  // средний выигрыш меньше среднего убытка. Без этой пары чисел высокий
  // винрейт вводит в заблуждение сильнее, чем низкий.
  if (wins.length >= MIN_GROUP && losses.length >= MIN_GROUP) {
    const avgWin = mean(wins.map((t) => t.pnl));
    const avgLoss = Math.abs(mean(losses.map((t) => t.pnl)));
    const winRate = wins.length / trades.length;
    const total = trades.reduce((a, t) => a + t.pnl, 0);
    if (winRate > 0.5 && total < 0 && avgLoss > avgWin) {
      insights.push({
        id: "payoffGap",
        tone: "warn",
        values: { winRate: Math.round(winRate * 100), ratio: (avgLoss / (avgWin || 1)).toFixed(1) },
      });
    }
  }

  // 3. Сделки без стопа. Считаем по позиции, а не по журналу: стоп — свойство
  // позиции, журнал знает о нём только косвенно (rMultiple = 0).
  const noStop = trades.filter((t) => t.position.stopLoss == null);
  if (noStop.length / trades.length >= NO_STOP_SHARE) {
    const withStop = trades.filter((t) => t.position.stopLoss != null);
    insights.push({
      id: "noStop",
      tone: "warn",
      values: {
        share: Math.round((noStop.length / trades.length) * 100),
        avgNoStop: Math.round(mean(noStop.map((t) => t.pnl))),
        avgWithStop: withStop.length >= MIN_GROUP ? Math.round(mean(withStop.map((t) => t.pnl))) : "—",
      },
    });
  }

  // 4. Отыгрыш: сделка, открытая сразу после убытка. Проверяем не намерение
  // (его не увидеть), а результат — и сравниваем с остальными сделками того
  // же игрока, а не с абстрактной нормой.
  const hot: number[] = [];
  const cold: number[] = [];
  for (const trade of trades) {
    const prior = trades.filter((t) => t.position.closedAt! <= trade.position.openedAt);
    const last = prior[prior.length - 1];
    const afterLoss = last != null && !last.win && trade.position.openedAt - last.position.closedAt! <= REVENGE_WINDOW_MS;
    (afterLoss ? hot : cold).push(trade.pnl);
  }
  if (hot.length >= MIN_GROUP && cold.length >= MIN_GROUP && mean(hot) < mean(cold)) {
    insights.push({
      id: "revenge",
      tone: "warn",
      values: { count: hot.length, avgHot: Math.round(mean(hot)), avgCold: Math.round(mean(cold)) },
    });
  }

  // 5. Плечо. Не «плечо — зло», а факт по этому конкретному счёту: с ним
  // выходит хуже или лучше, чем без него.
  const levered = trades.filter((t) => t.position.leverage > 1);
  const plain = trades.filter((t) => t.position.leverage <= 1);
  if (levered.length >= MIN_GROUP && plain.length >= MIN_GROUP) {
    const avgLevered = mean(levered.map((t) => t.pnl));
    const avgPlain = mean(plain.map((t) => t.pnl));
    if (avgLevered < 0 && avgLevered < avgPlain) {
      insights.push({
        id: "leverageHarm",
        tone: "warn",
        values: { avgLevered: Math.round(avgLevered), avgPlain: Math.round(avgPlain) },
      });
    }
  }

  // 6. Один инструмент. Не ошибка сама по себе — специализация бывает
  // осознанной, — поэтому говорим об этом, только если счёт в минусе.
  const byAsset = new Map<string, number>();
  for (const t of trades) byAsset.set(t.position.assetId, (byAsset.get(t.position.assetId) ?? 0) + 1);
  const [topAsset, topCount] = [...byAsset.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const totalPnl = trades.reduce((a, t) => a + t.pnl, 0);
  if (topCount / trades.length >= CONCENTRATION_SHARE && totalPnl < 0) {
    insights.push({
      id: "concentration",
      tone: "info",
      values: { asset: topAsset, share: Math.round((topCount / trades.length) * 100) },
    });
  }

  // 7. Что получается лучше всего. Разбор, состоящий из одних упрёков,
  // перестают читать — поэтому сильную сторону называем тоже.
  const byStyle = new Map<string, number[]>();
  for (const t of trades) {
    const list = byStyle.get(t.position.style) ?? [];
    list.push(t.pnl);
    byStyle.set(t.position.style, list);
  }
  const styles = [...byStyle.entries()].filter(([, v]) => v.length >= MIN_GROUP);
  if (styles.length >= 2) {
    const ranked = styles.map(([style, v]) => ({ style, avg: mean(v) })).sort((a, b) => b.avg - a.avg);
    if (ranked[0].avg > 0) {
      insights.push({
        id: "bestStyle",
        tone: "good",
        values: { style: ranked[0].style, avg: Math.round(ranked[0].avg) },
      });
    }
    // И слабый стиль тоже. Знать, что лучше всего идёт свинг, полезно; знать,
    // что скальпинг стабильно съедает заработанное, — полезнее: это
    // конкретное действие, которое можно перестать делать завтра.
    const worst = ranked[ranked.length - 1];
    if (worst.avg < 0 && worst.style !== ranked[0].style) {
      insights.push({
        id: "worstStyle",
        tone: "warn",
        values: { style: worst.style, avg: Math.round(worst.avg) },
      });
    }
  }

  // 8. Дисциплина по журналу: доля сделок, закрытых лучше своего риска.
  const withR = journal.filter((j) => j.rMultiple !== 0);
  if (withR.length >= MIN_TRADES) {
    const bigWins = withR.filter((j) => j.rMultiple >= 2).length;
    if (bigWins / withR.length < 0.1) {
      insights.push({
        id: "noBigWins",
        tone: "info",
        values: { share: Math.round((bigWins / withR.length) * 100) },
      });
    }
  }

  return insights.slice(0, limit);
}
