// Поддержание стакана Bybit v5 (linear perpetual). Bybit при подписке шлёт
// полный snapshot, далее delta; на (ре)коннекте снова snapshot — поэтому
// отдельный REST-ресинк не нужен, восстановление = переподписка.

// Для linear Bybit максимальная глубина WS — 200 уровней (покрывает узкую
// полосу у цены; шире отдаёт только Binance/OKX).
export function createBybitBook({ symbol, depth = 200, onResync, onError } = {}) {
  const SYM = symbol.toUpperCase();
  const WS_URL = "wss://stream.bybit.com/v5/public/linear";
  const topic = `orderbook.${depth}.${SYM}`;

  const bids = new Map();
  const asks = new Map();
  let ws = null;
  let synced = false;
  let closed = false;
  let pingTimer = null;
  let resyncCount = 0;
  let appliedCount = 0;

  function applySide(map, levels) {
    for (const [p, q] of levels) {
      const qty = Number(q);
      if (qty === 0) map.delete(p);
      else map.set(p, qty);
    }
  }

  function onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.op === "pong" || msg.op === "subscribe" || msg.op === "ping") return;
    if (msg.topic !== topic || !msg.data) return;
    const d = msg.data;
    if (msg.type === "snapshot") {
      bids.clear();
      asks.clear();
      applySide(bids, d.b ?? []);
      applySide(asks, d.a ?? []);
      synced = true;
      appliedCount++;
    } else if (msg.type === "delta") {
      applySide(bids, d.b ?? []);
      applySide(asks, d.a ?? []);
      appliedCount++;
    }
  }

  function connect() {
    if (closed) return;
    ws = new WebSocket(WS_URL);
    ws.addEventListener("open", () => {
      synced = false;
      ws.send(JSON.stringify({ op: "subscribe", args: [topic] }));
      pingTimer = setInterval(() => {
        try { ws.send(JSON.stringify({ op: "ping" })); } catch {}
      }, 20000);
    });
    ws.addEventListener("message", (e) => onMessage(e.data));
    ws.addEventListener("close", () => {
      synced = false;
      if (pingTimer) clearInterval(pingTimer);
      if (!closed) {
        resyncCount++;
        onResync?.("reconnect");
        setTimeout(connect, 1000);
      }
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
