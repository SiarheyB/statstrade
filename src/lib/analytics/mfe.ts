// MFE/MAE закрытых сделок — считаются ОДИН РАЗ и сохраняются в Trade.
//
// Раньше это жило целиком в браузере: `lib/analytics/exitEfficiency.ts` на
// каждый клик «Посчитать» на странице «Аналитика» делал до maxTrades запросов
// к публичному API биржи за свечами, считал MFE/MAE и выбрасывал результат.
// Следующий клик повторял всё заново — десятки секунд и риск словить
// rate-limit. У ЗАКРЫТОЙ сделки эти величины неизменны, так что это ровно тот
// случай, который нужно посчитать один раз.
//
// Заполняется фоново, порциями (см. вызовы в instrumentation.ts и
// /api/exit-efficiency). Планировщик для этого НЕ используется: на проде
// ENABLE_SCHEDULER=false (синк гоняет системный крон хоста), и воркер бы там
// просто не запускался.

import { prisma } from "@/lib/db";
import { getPublicExchange, type MarketKind } from "@/lib/exchanges";
import { isExchangeId } from "@/lib/exchangeIds";
import { computeExitAnalysis, candlesLookReal, type Candle } from "./exitAnalysis";

// Сколько раз пробуем сделку, прежде чем считать её безнадёжной (делистнутая
// пара, биржа не отдаёт историю так глубоко). Совпадает с условием частичного
// индекса Trade_mfe_queue_idx — менять только вместе с миграцией.
const MAX_ATTEMPTS = 3;

const TF_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

// Тот же выбор таймфрейма, что в /api/trade-chart, — чтобы сохранённые числа
// совпадали с тем, что рисует hover-график сделки.
function pickTimeframe(spanMs: number): string {
  if (spanMs < 3 * 3_600_000) return "1m";
  if (spanMs < 12 * 3_600_000) return "5m";
  if (spanMs < 2 * 86_400_000) return "15m";
  if (spanMs < 10 * 86_400_000) return "1h";
  if (spanMs < 60 * 86_400_000) return "4h";
  return "1d";
}

type QueuedTrade = {
  id: string;
  exchange: string;
  symbol: string;
  market: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  entryTime: Date;
  exitTime: Date;
};

async function fetchCandles(t: QueuedTrade): Promise<Candle[] | null> {
  if (!isExchangeId(t.exchange)) return null;
  const from = t.entryTime.getTime();
  const to = t.exitTime.getTime();
  const durationMs = Math.max(to - from, 60_000);
  const pad = Math.max(durationMs * 0.3, 30 * 60_000);
  const start = from - pad;
  const end = to + pad;
  const span = end - start;
  const tf = pickTimeframe(span);
  const limit = Math.min(500, Math.ceil(span / TF_MS[tf]) + 5);
  const kind: MarketKind = t.market === "spot" ? "spot" : "swap";

  const ex = await getPublicExchange(t.exchange, kind);
  if (!ex.has["fetchOHLCV"]) return null;
  const raw = (await ex.fetchOHLCV(t.symbol, tf, Math.floor(start), limit)) as number[][];
  return raw
    .filter((c) => c[0] >= start && c[0] <= end)
    .map((c) => ({ t: c[0], o: c[1], h: c[2], l: c[3], c: c[4] }));
}

// Запускает `worker` над `items`, держа не более `concurrency` в полёте.
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let i = 0;
  async function next(): Promise<void> {
    const idx = i++;
    if (idx >= items.length) return;
    await worker(items[idx]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

export type MfeFillResult = { picked: number; filled: number; failed: number };

// Досчитать MFE/MAE для порции сделок, у которых его ещё нет.
//
// Идемпотентно и безопасно вызывать часто: когда очередь пуста, запрос ничего
// не находит и функция сразу выходит. Ошибки отдельной сделки не роняют
// остальные — только увеличивают её счётчик попыток.
export async function fillMissingMfe(
  opts: { limit?: number; concurrency?: number } = {},
): Promise<MfeFillResult> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 25));
  const concurrency = Math.max(1, Math.min(5, opts.concurrency ?? 3));

  const queued = (await prisma.trade.findMany({
    where: { mfeAt: null, mfeAttempts: { lt: MAX_ATTEMPTS } },
    // Свежие сделки важнее: именно их пользователь смотрит на «Аналитике».
    orderBy: { exitTime: "desc" },
    take: limit,
    select: {
      id: true, exchange: true, symbol: true, market: true, side: true,
      entryPrice: true, exitPrice: true, entryTime: true, exitTime: true,
    },
  })) as QueuedTrade[];
  if (queued.length === 0) return { picked: 0, filled: 0, failed: 0 };

  let filled = 0;
  let failed = 0;

  await runPool(queued, concurrency, async (t) => {
    try {
      const candles = await fetchCandles(t);
      // candlesLookReal — та же проверка «это правда рыночные данные», что у
      // hover-графика: если цены сделки не попадают в свечи, считать нельзя.
      if (!candles || !candlesLookReal(candles, t.entryPrice, t.exitPrice)) {
        await prisma.trade.update({
          where: { id: t.id },
          data: { mfeAttempts: { increment: 1 } },
        });
        failed += 1;
        return;
      }
      const a = computeExitAnalysis(
        candles,
        t.side === "long" ? "long" : "short",
        t.entryPrice,
        t.exitPrice,
      );
      if (!a) {
        await prisma.trade.update({
          where: { id: t.id },
          data: { mfeAttempts: { increment: 1 } },
        });
        failed += 1;
        return;
      }
      await prisma.trade.update({
        where: { id: t.id },
        data: {
          mfePct: a.mfePct,
          maePct: a.maePct,
          capturedPct: a.capturedPct,
          bestPrice: a.bestPrice,
          mfeAt: new Date(),
        },
      });
      filled += 1;
    } catch {
      // Биржа недоступна / rate limit / делистнутая пара — попытка засчитана,
      // после MAX_ATTEMPTS сделка выпадет из очереди.
      await prisma.trade
        .update({ where: { id: t.id }, data: { mfeAttempts: { increment: 1 } } })
        .catch(() => {});
      failed += 1;
    }
  });

  return { picked: queued.length, filled, failed };
}

// Сколько сделок ещё ждёт расчёта — для индикатора «данные догружаются».
export async function pendingMfeCount(): Promise<number> {
  return prisma.trade.count({
    where: { mfeAt: null, mfeAttempts: { lt: MAX_ATTEMPTS } },
  });
}
