// Этап 0 — прототип collector: корректное поддержание локального стакана
// Binance USDⓈ-M Futures по diff-depth стриму, с контролем sequence и ресинком.
// Без БД и без зависимостей (глобальный WebSocket в Node 24). Лог в консоль.
//
// Запуск:  node collector/prototype.mjs
//   опц.:  SYMBOL=ethusdt RUN_MS=15000 node collector/prototype.mjs
//
// Правила сборки стакана (Binance Futures docs, "Manage a local order book"):
//  1. подписаться на <symbol>@depth@500ms и буферизовать события;
//  2. взять REST-снапшот /fapi/v1/depth?limit=1000 → lastUpdateId;
//  3. отбросить события с u < lastUpdateId;
//  4. первое обрабатываемое: U <= lastUpdateId <= u;
//  5. далее каждое событие: pu == u предыдущего, иначе РЕСИНК с шага 2;
//  6. qty == 0 → удалить ценовой уровень.

const SYMBOL = (process.env.SYMBOL ?? "btcusdt").toLowerCase();
const RUN_MS = Number(process.env.RUN_MS ?? 0); // 0 = бесконечно
const WS_URL = `wss://fstream.binance.com/ws/${SYMBOL}@depth@500ms`;
const REST_URL = `https://fapi.binance.com/fapi/v1/depth?symbol=${SYMBOL.toUpperCase()}&limit=1000`;
const LOG_EVERY_MS = 3000;
const WALL_RANGE_PCT = 0.02; // показывать крупнейшие стены в пределах ±2% от mid

let ws = null;
let buffer = [];
let synced = false;
let lastU = null; // u последнего применённого события
let snapLastUpdateId = null; // lastUpdateId последнего REST-снапшота
let firstApplied = false; // применили ли первое событие после снапшота
let resyncing = false;
let resyncCount = 0;
let appliedCount = 0;

const bids = new Map(); // priceStr -> qty (number)
const asks = new Map();

function applySide(map, levels) {
  for (const [priceStr, qtyStr] of levels) {
    const qty = Number(qtyStr);
    if (qty === 0) map.delete(priceStr);
    else map.set(priceStr, qty);
  }
}

function applyEvent(ev) {
  applySide(bids, ev.b ?? []);
  applySide(asks, ev.a ?? []);
  lastU = ev.u;
  appliedCount++;
}

// Применить одно событие к синхронизированному стакану по правилам 3-6.
// Возвращает false, если обнаружен разрыв sequence (нужен ресинк).
function handleEvent(ev) {
  if (!firstApplied) {
    if (ev.u < snapLastUpdateId) return true; // правило 3 — старое, дропаем
    // правило 4: первое событие должно охватывать lastUpdateId снапшота
    if (ev.U <= snapLastUpdateId && ev.u >= snapLastUpdateId) {
      applyEvent(ev);
      firstApplied = true;
    }
    return true; // не подошло (ещё старое) — ждём следующее
  }
  // правило 5: pu текущего == u предыдущего применённого
  if (ev.pu !== lastU) return false;
  applyEvent(ev);
  return true;
}

async function snapshotAndSync() {
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

    // Прогоняем накопленный буфер через единый обработчик.
    const pending = buffer;
    buffer = [];
    synced = true;
    resyncing = false;
    for (const ev of pending) {
      if (!handleEvent(ev)) {
        console.warn(`[resync] разрыв sequence в буфере (pu=${ev.pu}, lastU=${lastU})`);
        return snapshotAndSync();
      }
    }
    console.log(`[sync] стакан синхронизирован (lastUpdateId=${snapLastUpdateId}, из буфера: ${pending.length})`);
  } catch (err) {
    resyncing = false;
    console.error(`[sync] ошибка снапшота: ${err.message} — повтор через 1с`);
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
    buffer.push(ev); // ещё синхронизируемся — копим
    return;
  }
  if (!handleEvent(ev)) {
    console.warn(`[resync] разрыв sequence в потоке (pu=${ev.pu}, lastU=${lastU})`);
    if (!resyncing) snapshotAndSync();
  }
}

function connect() {
  ws = new WebSocket(WS_URL);
  ws.addEventListener("open", () => {
    console.log(`[ws] подключено: ${WS_URL}`);
    buffer = [];
    synced = false;
    snapshotAndSync();
  });
  ws.addEventListener("message", (e) => onMessage(e.data));
  ws.addEventListener("close", () => {
    console.warn("[ws] соединение закрыто — переподключение через 1с");
    synced = false;
    setTimeout(connect, 1000);
  });
  ws.addEventListener("error", (e) => {
    console.error(`[ws] ошибка: ${e.message ?? "unknown"}`);
    try { ws.close(); } catch {}
  });
}

function bestOf(map, side) {
  let best = null;
  for (const [p, q] of map) {
    const price = Number(p);
    if (best === null || (side === "bid" ? price > best.price : price < best.price)) {
      best = { price, qty: q };
    }
  }
  return best;
}

function topWalls(map, mid, n = 3) {
  const lo = mid * (1 - WALL_RANGE_PCT);
  const hi = mid * (1 + WALL_RANGE_PCT);
  return [...map.entries()]
    .map(([p, q]) => ({ price: Number(p), qty: q }))
    .filter((l) => l.price >= lo && l.price <= hi)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, n);
}

function report() {
  if (!synced) {
    console.log(`[stat] синхронизация… (buffer=${buffer.length})`);
    return;
  }
  const bb = bestOf(bids, "bid");
  const ba = bestOf(asks, "ask");
  if (!bb || !ba) return;
  const mid = (bb.price + ba.price) / 2;
  const bidWalls = topWalls(bids, mid);
  const askWalls = topWalls(asks, mid);
  console.log(
    `[stat] mid=${mid.toFixed(1)} spread=${(ba.price - bb.price).toFixed(2)} ` +
      `levels(b/a)=${bids.size}/${asks.size} applied=${appliedCount} resyncs=${resyncCount}`,
  );
  console.log(
    `       bid-стены: ${bidWalls.map((w) => `${w.price.toFixed(0)}×${w.qty.toFixed(2)}`).join("  ")}`,
  );
  console.log(
    `       ask-стены: ${askWalls.map((w) => `${w.price.toFixed(0)}×${w.qty.toFixed(2)}`).join("  ")}`,
  );
}

console.log(`[start] collector-прототип для ${SYMBOL.toUpperCase()} (Binance Futures)`);
connect();
const timer = setInterval(report, LOG_EVERY_MS);

if (RUN_MS > 0) {
  setTimeout(() => {
    clearInterval(timer);
    console.log(`[stop] завершение после ${RUN_MS}мс (applied=${appliedCount}, resyncs=${resyncCount})`);
    try { ws?.close(); } catch {}
    process.exit(0);
  }, RUN_MS);
}
