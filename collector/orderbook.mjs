// Поддержание локального стакана Binance USDⓈ-M Futures по diff-depth стриму.
// Корректная синхронизация по правилам Binance (snapshot + sequence + ресинк).
// Без внешних зависимостей (глобальный WebSocket Node 24).

export function createOrderBook({ symbol, depthMs = 500, onResync, onError } = {}) {
  const sym = symbol.toLowerCase();
  const WS_URL = `wss://fstream.binance.com/ws/${sym}@depth@${depthMs}ms`;
  const REST_URL = `https://fapi.binance.com/fapi/v1/depth?symbol=${sym.toUpperCase()}&limit=1000`;

  const bids = new Map(); // priceStr -> qty
  const asks = new Map();

  let ws = null;
  let buffer = [];
  let synced = false;
  let lastU = null;
  let snapLastUpdateId = null;
  let firstApplied = false;
  let resyncing = false;
  let closed = false;
  let resyncCount = 0;
  let appliedCount = 0;

  function applySide(map, levels) {
    for (const [p, q] of levels) {
      const qty = Number(q);
      if (qty === 0) map.delete(p);
      else map.set(p, qty);
    }
  }

  function applyEvent(ev) {
    applySide(bids, ev.b ?? []);
    applySide(asks, ev.a ?? []);
    lastU = ev.u;
    appliedCount++;
  }

  // Правила Binance Futures 3-6. false → нужен ресинк.
  function handleEvent(ev) {
    if (!firstApplied) {
      if (ev.u < snapLastUpdateId) return true; // правило 3
      if (ev.U <= snapLastUpdateId && ev.u >= snapLastUpdateId) {
        applyEvent(ev);
        firstApplied = true;
      }
      return true;
    }
    if (ev.pu !== lastU) return false; // правило 5
    applyEvent(ev);
    return true;
  }

  async function snapshotAndSync() {
    if (closed) return;
    resyncing = true;
    synced = false;
    firstApplied = false;
    resyncCount++;
    try {
      const res = await fetch(REST_URL, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`REST HTTP ${res.status}`);
      const snap = await res.json();
      snapLastUpdateId = snap.lastUpdateId;
      bids.clear();
      asks.clear();
      applySide(bids, snap.bids);
      applySide(asks, snap.asks);
      lastU = snapLastUpdateId;

      const pending = buffer;
      buffer = [];
      synced = true;
      resyncing = false;
      for (const ev of pending) {
        if (!handleEvent(ev)) {
          onResync?.("buffer");
          return snapshotAndSync();
        }
      }
    } catch (err) {
      resyncing = false;
      onError?.(err);
      setTimeout(snapshotAndSync, 1000);
    }
  }

  function onMessage(raw) {
    let ev;
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    if (ev.e !== "depthUpdate") return;
    if (!synced) {
      buffer.push(ev);
      return;
    }
    if (!handleEvent(ev)) {
      onResync?.("stream");
      if (!resyncing) snapshotAndSync();
    }
  }

  function connect() {
    if (closed) return;
    ws = new WebSocket(WS_URL);
    ws.addEventListener("open", () => {
      buffer = [];
      synced = false;
      snapshotAndSync();
    });
    ws.addEventListener("message", (e) => onMessage(e.data));
    ws.addEventListener("close", () => {
      synced = false;
      if (!closed) setTimeout(connect, 1000);
    });
    ws.addEventListener("error", (e) => {
      onError?.(e?.message ? new Error(e.message) : new Error("ws error"));
      try { ws.close(); } catch {}
    });
  }

  function close() {
    closed = true;
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
    bids,
    asks,
    connect,
    close,
    bestBid,
    bestAsk,
    get synced() { return synced; },
    get stats() { return { resyncCount, appliedCount, bidLevels: bids.size, askLevels: asks.size }; },
    get url() { return WS_URL; },
  };
}
