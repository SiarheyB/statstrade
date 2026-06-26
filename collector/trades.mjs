// Лента сделок Binance USDⓈ-M Futures (@trade) для расчёта дельты.
// Накапливает объёмы покупок/продаж между снапшотами; drain() отдаёт и обнуляет.
// m=true → покупатель мейкер → агрессор ПРОДАЛ; m=false → агрессор КУПИЛ.

export function createBinanceTrades({ symbol, onError } = {}) {
  const sym = symbol.toLowerCase();
  const WS_URL = `wss://fstream.binance.com/ws/${sym}@trade`;

  let ws = null;
  let closed = false;
  let buyVol = 0;
  let sellVol = 0;

  function onMessage(raw) {
    let ev;
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    if (ev.e !== "trade") return;
    const qty = Number(ev.q);
    if (!Number.isFinite(qty)) return;
    if (ev.m) sellVol += qty;
    else buyVol += qty;
  }

  function connect() {
    if (closed) return;
    ws = new WebSocket(WS_URL);
    ws.addEventListener("message", (e) => onMessage(e.data));
    ws.addEventListener("close", () => {
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

  // Отдать накопленное и обнулить.
  function drain() {
    const out = { buyVol, sellVol };
    buyVol = 0;
    sellVol = 0;
    return out;
  }

  return { connect, close, drain, get url() { return WS_URL; } };
}
