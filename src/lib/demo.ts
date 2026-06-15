import { prisma } from "./db";
import { reconstructTrades } from "./analytics/positions";
import type { FillInput } from "./analytics/types";
import {
  parseOptions,
  DEFAULT_ENTRY_POINTS,
  DEFAULT_ENTRY_TYPES,
  DEFAULT_MISTAKES,
} from "./annotations";

// Generates realistic synthetic fills so the whole analytics + UI pipeline can
// be exercised without connecting a real exchange account.

type DemoSymbol = {
  base: string;
  quote: string;
  price: number;
  vol: number; // typical per-trade price move (fraction)
  market: "spot" | "swap";
};

const SYMBOLS: DemoSymbol[] = [
  { base: "BTC", quote: "USDT", price: 64000, vol: 0.04, market: "swap" },
  { base: "ETH", quote: "USDT", price: 3100, vol: 0.05, market: "swap" },
  { base: "SOL", quote: "USDT", price: 150, vol: 0.08, market: "swap" },
  { base: "BNB", quote: "USDT", price: 580, vol: 0.04, market: "spot" },
  { base: "XRP", quote: "USDT", price: 0.52, vol: 0.06, market: "spot" },
  { base: "DOGE", quote: "USDT", price: 0.14, vol: 0.09, market: "swap" },
  { base: "LINK", quote: "USDT", price: 14, vol: 0.07, market: "spot" },
];

const FEE_RATE = 0.0005; // 0.05% taker

function randn(): number {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

type DemoFillRow = {
  accountId: string;
  exchange: string;
  tradeId: string;
  orderId: string | null;
  symbol: string;
  base: string;
  quote: string;
  market: string;
  side: string;
  price: number;
  amount: number;
  cost: number;
  fee: number;
  feeCurrency: string;
  realizedPnl: number | null;
  takerOrMaker: string;
  timestamp: Date;
};

export function generateDemoFills(
  accountId: string,
  exchange: string,
  tradeCount = 140,
  lookbackDays = 180,
): DemoFillRow[] {
  const rows: DemoFillRow[] = [];
  const now = Date.now();
  let counter = 0;

  for (let i = 0; i < tradeCount; i++) {
    const sym = pick(SYMBOLS);
    const symbol = sym.market === "swap" ? `${sym.base}/${sym.quote}:${sym.quote}` : `${sym.base}/${sym.quote}`;
    const isLong = Math.random() < 0.6;

    // ~56% winners with a slight positive expectancy
    const isWin = Math.random() < 0.56;
    const moveMag = Math.abs(randn()) * sym.vol;
    const favorable = isWin ? moveMag : -moveMag * 0.85;

    const entryPrice = sym.price * (1 + randn() * 0.1);
    const dir = isLong ? 1 : -1;
    const exitPrice = entryPrice * (1 + dir * favorable);

    // position sized to ~ $200-$2500 notional
    const notional = 200 + Math.random() * 2300;
    const amount = notional / entryPrice;

    const entryTime = new Date(now - Math.random() * lookbackDays * 24 * 3600 * 1000);
    const holdMs = (5 + Math.random() * 60 * 24) * 60 * 1000; // 5 min .. 60h
    const exitTime = new Date(entryTime.getTime() + holdMs);

    const entryCost = entryPrice * amount;
    const exitCost = exitPrice * amount;

    const entrySide = isLong ? "buy" : "sell";
    const exitSide = isLong ? "sell" : "buy";

    rows.push({
      accountId,
      exchange,
      tradeId: `demo-${i}-open-${counter++}`,
      orderId: `demo-o-${i}-open`,
      symbol,
      base: sym.base,
      quote: sym.quote,
      market: sym.market,
      side: entrySide,
      price: entryPrice,
      amount,
      cost: entryCost,
      fee: entryCost * FEE_RATE,
      feeCurrency: sym.quote,
      realizedPnl: null,
      takerOrMaker: "taker",
      timestamp: entryTime,
    });

    const grossPnl = dir * (exitPrice - entryPrice) * amount;
    rows.push({
      accountId,
      exchange,
      tradeId: `demo-${i}-close-${counter++}`,
      orderId: `demo-o-${i}-close`,
      symbol,
      base: sym.base,
      quote: sym.quote,
      market: sym.market,
      side: exitSide,
      price: exitPrice,
      amount,
      cost: exitCost,
      fee: exitCost * FEE_RATE,
      feeCurrency: sym.quote,
      realizedPnl: grossPnl,
      takerOrMaker: "taker",
      timestamp: exitTime,
    });
  }

  return rows;
}

export async function seedDemoData(
  accountId: string,
  exchange: string,
  userId: string,
): Promise<number> {
  // Clear any previous demo fills and their annotations for a clean slate.
  await prisma.fill.deleteMany({
    where: { accountId, tradeId: { startsWith: "demo-" } },
  });
  await prisma.tradeAnnotation.deleteMany({
    where: { userId, tradeKey: { startsWith: `${accountId}:` } },
  });

  const rows = generateDemoFills(accountId, exchange);
  await prisma.fill.createMany({ data: rows });

  // Reconstruct trades from the generated fills and attach random annotations,
  // so the demo also populates the ТВХ / тип-входа columns.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      entryPointOptions: true,
      entryTypeOptions: true,
      mistakeOptions: true,
    },
  });
  const entryPoints = parseOptions(user?.entryPointOptions, DEFAULT_ENTRY_POINTS);
  const entryTypes = parseOptions(user?.entryTypeOptions, DEFAULT_ENTRY_TYPES);
  const mistakes = parseOptions(user?.mistakeOptions, DEFAULT_MISTAKES);

  const fills: FillInput[] = rows.map((r) => ({
    symbol: r.symbol,
    base: r.base,
    quote: r.quote,
    market: r.market,
    side: r.side,
    price: r.price,
    amount: r.amount,
    fee: r.fee,
    feeCurrency: r.feeCurrency,
    timestamp: r.timestamp,
    exchange: r.exchange,
    accountId: r.accountId,
  }));

  const trades = reconstructTrades(fills);
  const annotations = trades
    .map((t) => {
      const isLong = t.side === "long";
      // Logged stop-loss on ~70% of trades, placed coherently so the R-multiple
      // is realistic: losers ≈ -1R (stopped out, occasional slippage to ~-1.3R),
      // winners +1.2..3R. Stop sits on the correct side of entry.
      const hasStop = Math.random() < 0.7;
      let stopLoss: number | null = null;
      if (hasStop) {
        const move = Math.abs(t.exitPrice - t.entryPrice);
        let riskDist: number;
        if (t.result === "loss") {
          const lossR = 1 + (Math.random() < 0.25 ? Math.random() * 0.3 : 0);
          riskDist = move / lossR;
        } else if (t.result === "win") {
          const targetR = 1.2 + Math.random() * 1.8;
          riskDist = move / targetR;
        } else {
          riskDist = t.entryPrice * (0.01 + Math.random() * 0.02);
        }
        if (riskDist > 0) {
          const sl = isLong ? t.entryPrice - riskDist : t.entryPrice + riskDist;
          if (sl > 0) stopLoss = Number(sl.toFixed(6));
        }
      }
      // mistakes are more common on losers
      const mistakeProb = t.result === "loss" ? 0.5 : 0.12;
      return {
        userId,
        tradeKey: t.id,
        // leave some trades unmarked for realism
        entryPoint: Math.random() < 0.8 && entryPoints.length ? pick(entryPoints) : null,
        entryType: Math.random() < 0.75 && entryTypes.length ? pick(entryTypes) : null,
        mistake: Math.random() < mistakeProb && mistakes.length ? pick(mistakes) : null,
        stopLoss,
        note: null as string | null,
      };
    })
    .filter((a) => a.entryPoint || a.entryType || a.mistake || a.stopLoss != null);

  if (annotations.length) {
    await prisma.tradeAnnotation.createMany({ data: annotations });
  }

  return rows.length;
}
