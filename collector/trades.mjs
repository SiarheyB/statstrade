// Лента сделок для дельты + footprint + крупных ордеров. Поддерживает Binance,
// Bybit и OKX: общий аккумулятор + per-exchange WS-парсер. drain() отдаёт
// {buyVol, sellVol, footprint, big} и обнуляет.
//
// Сторона = агрессор (taker). Binance: m=true → продажа. Bybit: S="Buy"/"Sell".
// OKX: side="buy"/"sell", размер в контрактах (×ctVal → базовые единицы).

import { ctValFor } from "./okx.mjs";

function makeAccumulator(binSize, bigNotional) {
  let buyVol = 0;
  let sellVol = 0;
  let bins = new Map(); // priceBinCenter -> { buy, sell }
  let big = [];

  function ingest(price, qty, buy, ts) {
    if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) return;
    if (buy) buyVol += qty;
    else sellVol += qty;
    const center = Math.round(price / binSize) * binSize;
    const cell = bins.get(center) ?? { buy: 0, sell: 0 };
    if (buy) cell.buy += qty;
    else cell.sell += qty;
    bins.set(center, cell);
    if (qty * price >= bigNotional && big.length < 500) {
      big.push({ t: ts || Date.now(), price, qty, side: buy ? "buy" : "sell" });
    }
  }

  function drain() {
    const footprint = [...bins.entries()].map(([price, c]) => ({ price, buy: c.buy, sell: c.sell }));
    const out = { buyVol, sellVol, footprint, big };
    buyVol = 0;
    sellVol = 0;
    bins = new Map();
    big = [];
    return out;
  }

  return { ingest, drain };
}

// --- Per-exchange WS adapters: каждый зовёт acc.ingest(price, qty, buy, ts) ---

function connectBinanceAt(host) {
  return (symbol, acc, onError, ref) => {
    const url = `wss://${host}/ws/${symbol.toLowerCase()}@trade`;
    const open = () => {
      if (ref.closed) return;
      const ws = new WebSocket(url);
      ref.ws = ws;
      ws.addEventListener("message", (e) => {
        let ev;
        try { ev = JSON.parse(e.data); } catch { return; }
        if (ev.e !== "trade") return;
        acc.ingest(Number(ev.p), Number(ev.q), !ev.m, Number(ev.T));
      });
      ws.addEventListener("close", () => { if (!ref.closed) setTimeout(open, 1000); });
      ws.addEventListener("error", (e) => { onError?.(new Error(e?.message ?? "ws error")); try { ws.close(); } catch {} });
    };
    return open;
  };
}

function connectBybit(symbol, acc, onError, ref) {
  const url = "wss://stream.bybit.com/v5/public/linear";
  const topic = `publicTrade.${symbol.toUpperCase()}`;
  const open = () => {
    if (ref.closed) return;
    const ws = new WebSocket(url);
    ref.ws = ws;
    let ping;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ op: "subscribe", args: [topic] }));
      ping = setInterval(() => { try { ws.send(JSON.stringify({ op: "ping" })); } catch {} }, 20000);
    });
    ws.addEventListener("message", (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.topic !== topic || !Array.isArray(m.data)) return;
      for (const tr of m.data) {
        acc.ingest(Number(tr.p), Number(tr.v), tr.S === "Buy", Number(tr.T));
      }
    });
    ws.addEventListener("close", () => { if (ping) clearInterval(ping); if (!ref.closed) setTimeout(open, 1000); });
    ws.addEventListener("error", (e) => { onError?.(new Error(e?.message ?? "ws error")); try { ws.close(); } catch {} });
  };
  return open;
}

function connectOkx(symbol, acc, onError, ref) {
  const s = symbol.toUpperCase();
  const base = s.replace(/(USDT|USDC|USD)$/, "");
  const quote = s.slice(base.length);
  const instId = `${base}-${quote || "USDT"}-SWAP`;
  const ctVal = ctValFor(symbol);
  const url = "wss://ws.okx.com:8443/ws/v5/public";
  const open = () => {
    if (ref.closed) return;
    const ws = new WebSocket(url);
    ref.ws = ws;
    let ping;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: "trades", instId }] }));
      ping = setInterval(() => { try { ws.send("ping"); } catch {} }, 25000);
    });
    ws.addEventListener("message", (e) => {
      if (e.data === "pong") return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.event || !Array.isArray(m.data) || m.arg?.instId !== instId) return;
      for (const tr of m.data) {
        acc.ingest(Number(tr.px), Number(tr.sz) * ctVal, tr.side === "buy", Number(tr.ts));
      }
    });
    ws.addEventListener("close", () => { if (ping) clearInterval(ping); if (!ref.closed) setTimeout(open, 1000); });
    ws.addEventListener("error", (e) => { onError?.(new Error(e?.message ?? "ws error")); try { ws.close(); } catch {} });
  };
  return open;
}

const ADAPTERS = {
  "binance-futures": connectBinanceAt("fstream.binance.com"),
  "binance-spot": connectBinanceAt("stream.binance.com:9443"),
  "bybit-futures": connectBybit,
  "okx-futures": connectOkx,
};

export function createTradeFeed({ exchange, symbol, binSize = 25, bigNotional = 100000, onError } = {}) {
  const acc = makeAccumulator(binSize, bigNotional);
  const ref = { closed: false, ws: null };
  const adapter = ADAPTERS[exchange];
  const open = adapter ? adapter(symbol, acc, onError, ref) : null;

  return {
    connect() { if (open) open(); },
    close() { ref.closed = true; try { ref.ws?.close(); } catch {} },
    drain: acc.drain,
    supported: !!adapter,
  };
}
