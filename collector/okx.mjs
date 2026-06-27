// Поддержание стакана OKX (books, 400 уровней) для SWAP-инструмента.
// OKX шлёт action=snapshot, затем update с seqId/prevSeqId. CRC-checksum для
// heatmap не критична — при разрыве prevSeqId переподключаемся (resync).

function toInstId(symbol) {
  const s = symbol.toUpperCase();
  for (const q of ["USDT", "USDC", "USD"]) {
    if (s.endsWith(q)) return `${s.slice(0, -q.length)}-${q}-SWAP`;
  }
  return `${s}-USDT-SWAP`;
}

// Размер контракта SWAP (ctVal) — OKX отдаёт объём в контрактах, приводим к
// базовым единицам, чтобы агрегат с другими биржами был сопоставим.
const CT_VAL = { BTC: 0.01, ETH: 0.1, SOL: 1, XRP: 100, DOGE: 1000 };
export function ctValFor(symbol) {
  const base = symbol.toUpperCase().replace(/(USDT|USDC|USD)$/, "");
  return CT_VAL[base] ?? 1;
}

export function createOkxBook({ symbol, onResync, onError } = {}) {
  const instId = toInstId(symbol);
  const ctVal = ctValFor(symbol);
  const WS_URL = "wss://ws.okx.com:8443/ws/v5/public";

  const bids = new Map();
  const asks = new Map();
  let ws = null;
  let synced = false;
  let closed = false;
  let pingTimer = null;
  let lastSeqId = null;
  let resyncCount = 0;
  let appliedCount = 0;

  function applySide(map, levels) {
    for (const lvl of levels) {
      const p = lvl[0];
      const qty = Number(lvl[1]) * ctVal; // контракты → базовые единицы
      if (qty === 0) map.delete(p);
      else map.set(p, qty);
    }
  }

  function resync() {
    resyncCount++;
    onResync?.("seq");
    try { ws?.close(); } catch {}
  }

  function onMessage(raw) {
    if (raw === "pong") return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.event) return; // subscribe ack / error
    if (!msg.data || !msg.arg || msg.arg.instId !== instId) return;
    const d = msg.data[0];
    if (!d) return;
    if (msg.action === "snapshot") {
      bids.clear();
      asks.clear();
      applySide(bids, d.bids ?? []);
      applySide(asks, d.asks ?? []);
      lastSeqId = d.seqId;
      synced = true;
      appliedCount++;
    } else if (msg.action === "update") {
      if (lastSeqId !== null && d.prevSeqId !== lastSeqId) {
        resync();
        return;
      }
      applySide(bids, d.bids ?? []);
      applySide(asks, d.asks ?? []);
      lastSeqId = d.seqId;
      appliedCount++;
    }
  }

  function connect() {
    if (closed) return;
    ws = new WebSocket(WS_URL);
    ws.addEventListener("open", () => {
      synced = false;
      lastSeqId = null;
      ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: "books", instId }] }));
      pingTimer = setInterval(() => {
        try { ws.send("ping"); } catch {}
      }, 25000);
    });
    ws.addEventListener("message", (e) => onMessage(e.data));
    ws.addEventListener("close", () => {
      synced = false;
      if (pingTimer) clearInterval(pingTimer);
      if (!closed) setTimeout(connect, 1000);
    });
    ws.addEventListener("error", (e) => {
      onError?.(e?.message ? new Error(e.message) : new Error("ws error"));
      try { ws.close(); } catch {}
    });
  }

  function close() {
    closed = true;
    if (pingTimer) clearInterval(pingTimer);
    try { ws?.close(); } catch {}
  }

  function bestBid() {
    let best = null;
    for (const [p, q] of bids) {
      const price = Number(p);
      if (best === null || price > best.price) best = { price, qty: q };
    }
    return best;
  }
  function bestAsk() {
    let best = null;
    for (const [p, q] of asks) {
      const price = Number(p);
      if (best === null || price < best.price) best = { price, qty: q };
    }
    return best;
  }

  return {
    bids, asks, connect, close, bestBid, bestAsk,
    get synced() { return synced; },
    get stats() { return { resyncCount, appliedCount, bidLevels: bids.size, askLevels: asks.size }; },
    get url() { return WS_URL; },
  };
}
