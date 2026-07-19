#!/usr/bin/env node

// Юнит-тесты для критической логики коллектора.
// Запуск: DATABASE_URL="postgresql://..." node collector/unit-tests.mjs
// Не требует БД/Докера — чистые функции.

import { binSide, rowsForFeed, accumulateRollup, flushRollup, minCoinsFor as collectorMinCoinsFor, FACTORY, DEFAULT_BIN, DEFAULT_MIN_COINS } from "./index.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  return async () => {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`  ❌ ${name}`);
      console.error(`     ${err.message}`);
      failed++;
    }
  };
}

function assert(condition, msg = "Assertion failed") {
  if (!condition) throw new Error(msg);
}

function assertEqual(actual, expected, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} Expected ${e}, got ${a}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: binSide (binning logic from index.mjs)
// ─────────────────────────────────────────────────────────────────────────────

async function runBinSideTests() {
  console.log("\n🧪 binSide — биннинг ценовых уровней\n");

  await test("базовое биннирование: цены попадают в правильные центры", async () => {
    const bids = new Map([["100.1", 10], ["100.4", 5], ["101.2", 3]]);
    const asks = new Map([["100.3", 7], ["100.6", 2]]);
    const binSize = 0.5;
    const lo = 99;
    const hi = 102;

    // bidBins: 100.1→100.0, 100.4→100.5, 101.2→101.0
    // askBins: 100.3→100.5, 100.6→100.5
    const bidBins = binSide(bids, lo, hi, binSize);
    const askBins = binSide(asks, lo, hi, binSize);

    assertEqual(bidBins.get(100.0), 10);
    assertEqual(bidBins.get(100.5), 5);
    assertEqual(bidBins.get(101.0), 3);

    assertEqual(askBins.get(100.5), 9); // 7 + 2
  })();

  await test("цены вне диапазона [lo, hi] отбрасываются", async () => {
    const bids = new Map([["98.0", 10], ["105.0", 5]]);
    const result = binSide(bids, 100, 102, 1);
    assert(result.size === 0, "Ожидался пустой Map");
  })();

  await test("binSize=25 (BTCUSDT): проверка центров", async () => {
    const bids = new Map([["50010", 1], ["50030", 2], ["50060", 3]]);
    const result = binSide(bids, 49000, 51000, 25);
    // 50010/25=2000.4→2000*25=50000
    // 50030/25=2001.2→2001*25=50025
    // 50060/25=2002.4→2002*25=50050
    assertEqual(result.get(50000), 1);
    assertEqual(result.get(50025), 2);
    assertEqual(result.get(50050), 3);
  })();

  await test("binSize=0.5 (ETHUSDT): дробные центры", async () => {
    const bids = new Map([["3000.1", 1], ["3000.4", 2]]);
    const result = binSide(bids, 2900, 3100, 0.5);
    // 3000.1/0.5=6000.2→Math.round(6000.2)=6000→6000*0.5=3000.0
    // 3000.4/0.5=6000.8→Math.round(6000.8)=6001→6001*0.5=3000.5
    assertEqual(result.get(3000.0), 1);
    assertEqual(result.get(3000.5), 2);
  })();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Trade Feed Accumulator logic (from trades.mjs makeAccumulator)
// ─────────────────────────────────────────────────────────────────────────────

async function runTradeFeedTests() {
  console.log("\n🧪 TradeFeed accumulator (логика из makeAccumulator)\n");

  await test("ingest накапливает buyVol/sellVol и footprint", async () => {
    // Воссоздаём логику makeAccumulator из trades.mjs
    let buyVol = 0, sellVol = 0;
    let bins = new Map(); // priceBinCenter -> { buy, sell }
    let big = [];
    const binSize = 25;
    const bigNotional = 200000; // увеличено, чтобы ни одна тестовая сделка не считалась "большой"

    function ingest(price, qty, buy, ts) {
      if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) return;
      if (buy) buyVol += qty; else sellVol += qty;
      const center = Math.round(price / binSize) * binSize;
      const cell = bins.get(center) ?? { buy: 0, sell: 0 };
      if (buy) cell.buy += qty; else cell.sell += qty;
      bins.set(center, cell);
      if (qty * price >= bigNotional && big.length < 500) {
        big.push({ t: ts || Date.now(), price, qty, side: buy ? "buy" : "sell" });
      }
    }

    function drain() {
      const footprint = [...bins.entries()].map(([price, c]) => ({ price, buy: c.buy, sell: c.sell }));
      const out = { buyVol, sellVol, footprint, big };
      buyVol = 0; sellVol = 0; bins = new Map(); big = [];
      return out;
    }

    // Две покупки: одна по 50000, вторая по 50010 (обе бинятся в 50000 при binSize=25)
    ingest(50000, 1, true, 1000);
    ingest(50010, 2, true, 2000);  // покупка 2 BTC @ 50010 → бин 50000
    // Одна продажа 0.5 BTC @ 50025 (биннится в 50025)
    ingest(50025, 0.5, false, 3000);

    const out = drain();
    assertEqual(out.buyVol, 3);
    assertEqual(out.sellVol, 0.5);
    assertEqual(out.footprint.length, 2);
    // 50000→center 50000, 50010→50000, 50025→50025
    const fp = Object.fromEntries(out.footprint.map(f => [f.price, { buy: f.buy, sell: f.sell }]));
    assertEqual(fp[50000].buy, 3); // 1 + 2 = 3 (обе покупки в бин 50000)
    assertEqual(fp[50025].sell, 0.5);
    assertEqual(out.big.length, 0);
  })();

  await test("крупные сделки (big) попадают в массив", async () => {
    let buyVol = 0, sellVol = 0;
    let bins = new Map();
    let big = [];
    const binSize = 25;
    const bigNotional = 100000;

    function ingest(price, qty, buy, ts) {
      if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) return;
      if (buy) buyVol += qty; else sellVol += qty;
      const center = Math.round(price / binSize) * binSize;
      const cell = bins.get(center) ?? { buy: 0, sell: 0 };
      if (buy) cell.buy += qty; else cell.sell += qty;
      bins.set(center, cell);
      if (qty * price >= bigNotional && big.length < 500) {
        big.push({ t: ts || Date.now(), price, qty, side: buy ? "buy" : "sell" });
      }
    }

    function drain() {
      const footprint = [...bins.entries()].map(([price, c]) => ({ price, buy: c.buy, sell: c.sell }));
      const out = { buyVol, sellVol, footprint, big };
      buyVol = 0; sellVol = 0; bins = new Map(); big = [];
      return out;
    }

    // Сделка 3 BTC @ 50000 = 150000 > 100000 (bigNotional)
    ingest(50000, 3, true, 1000);
    // Маленькая сделка
    ingest(50000, 0.1, false, 2000);

    const out = drain();
    assertEqual(out.big.length, 1);
    assertEqual(out.big[0].price, 50000);
    assertEqual(out.big[0].qty, 3);
    assertEqual(out.big[0].side, "buy");
    // footprint всё равно накапливается
    const fp = Object.fromEntries(out.footprint.map(f => [f.price, { buy: f.buy, sell: f.sell }]));
    assertEqual(fp[50000].buy, 3);
    assertEqual(fp[50000].sell, 0.1);
  })();

  await test("drain обнуляет состояние (идемпотентность)", async () => {
    let buyVol = 0;
    let bins = new Map();
    const binSize = 25;

    function ingest(price, qty, buy) {
      if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) return;
      if (buy) buyVol += qty;
      const center = Math.round(price / binSize) * binSize;
      const cell = bins.get(center) ?? { buy: 0, sell: 0 };
      if (buy) cell.buy += qty;
      bins.set(center, cell);
    }

    function drain() {
      const out = { buyVol, bins: new Map(bins) };
      buyVol = 0; bins = new Map(); return out;
    }

    ingest(50000, 1, true);
    const out1 = drain();
    assertEqual(out1.buyVol, 1);
    const out2 = drain();
    assertEqual(out2.buyVol, 0);
    assertEqual(out2.bins.size, 0);
  })();

  await test("некорректные входные данные игнорируются", async () => {
    let buyVol = 0;
    function ingest(price, qty, buy) {
      if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) return;
      if (buy) buyVol += qty;
    }

    function drain() { const v = buyVol; buyVol = 0; return { buyVol: v }; }

    ingest(NaN, 1, true);
    ingest(50000, NaN, true);
    ingest(50000, 0, true);
    ingest(50000, -1, true);
    ingest(50000, 1, true); // валидная

    const out = drain();
    assertEqual(out.buyVol, 1);
  })();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Rollup Accumulator (accumulateRollup / flushRollup)
// ─────────────────────────────────────────────────────────────────────────────

async function runRollupTests() {
  console.log("\n🧪 Rollup accumulator (accumulateRollup / flushRollup)\n");

  await test("accumulateRollup накапливает несколько снапшотов в одном минутном бакете", async () => {
    const rollup = new Map(); // key -> { symbol, exchange, bucketMs, snaps, midSum, prices: Map }

    function accumulateRollup(symbol, exchange, t, rows, mid) {
      if (mid == null || rows.length === 0) return;
      const bucketMs = Math.floor(t.getTime() / 60_000) * 60_000;
      const key = `${symbol}|${exchange}|${bucketMs}`;
      let e = rollup.get(key);
      if (!e) {
        e = { symbol, exchange, bucketMs, snaps: 0, midSum: 0, prices: new Map() };
        rollup.set(key, e);
      }
      e.snaps += 1;
      e.midSum += mid;
      for (const r of rows) {
        const price = r[3];
        const bid = r[4];
        const ask = r[5];
        const cell = e.prices.get(price) ?? { vol: 0, bid: 0, ask: 0 };
        cell.vol += bid + ask;
        cell.bid += bid;
        cell.ask += ask;
        e.prices.set(price, cell);
      }
    }

    const t1 = new Date("2026-07-19T10:00:00.000Z");
    const t2 = new Date("2026-07-19T10:00:30.000Z"); // та же минута
    const t3 = new Date("2026-07-19T10:01:00.000Z"); // следующая минута

    // Снапшот 1: 2 ценовых уровня
    accumulateRollup("BTCUSDT", "binance-futures", t1, [
      ["BTCUSDT", "binance-futures", t1, 50000, 10, 5],
      ["BTCUSDT", "binance-futures", t1, 50025, 3, 7],
    ], 50012.5);

    // Снапшот 2: тот же бакет, добавляем объёмы
    accumulateRollup("BTCUSDT", "binance-futures", t2, [
      ["BTCUSDT", "binance-futures", t2, 50000, 5, 2],
      ["BTCUSDT", "binance-futures", t2, 50025, 1, 4],
    ], 50012.0);

    // Снапшот 3: новый бакет (следующая минута)
    accumulateRollup("BTCUSDT", "binance-futures", t3, [
      ["BTCUSDT", "binance-futures", t3, 50000, 8, 8],
    ], 50008.0);

    // Проверки
    assertEqual(rollup.size, 2);

    const key1 = "BTCUSDT|binance-futures|1784455200000"; // 10:00
    const key2 = "BTCUSDT|binance-futures|1784455260000"; // 10:01

    const b1 = rollup.get(key1);
    assertEqual(b1.snaps, 2);
    assertEqual(b1.midSum, 50012.5 + 50012.0);
    const p1 = b1.prices.get(50000);
    assertEqual(p1.vol, 10+5 + 5+2); // 22
    assertEqual(p1.bid, 10+5); // 15
    assertEqual(p1.ask, 5+2); // 7

    const b2 = rollup.get(key2);
    assertEqual(b2.snaps, 1);
    assertEqual(b2.midSum, 50008.0);
  })();

  await test("flushRollup удаляет только завершённые бакеты", async () => {
    const rollup = new Map();
    const flushed = [];

    function accumulateRollup(symbol, exchange, t, rows, mid) {
      if (mid == null || rows.length === 0) return;
      const bucketMs = Math.floor(t.getTime() / 60_000) * 60_000;
      const key = `${symbol}|${exchange}|${bucketMs}`;
      let e = rollup.get(key);
      if (!e) {
        e = { symbol, exchange, bucketMs, snaps: 0, midSum: 0, prices: new Map() };
        rollup.set(key, e);
      }
      e.snaps += 1;
      e.midSum += mid;
      for (const r of rows) {
        const price = r[3];
        const bid = r[4];
        const ask = r[5];
        const cell = e.prices.get(price) ?? { vol: 0, bid: 0, ask: 0 };
        cell.vol += bid + ask;
        cell.bid += bid;
        cell.ask += ask;
        e.prices.set(price, cell);
      }
    }

    async function flushRollup(now) {
      const curBucket = Math.floor(now.getTime() / 60_000) * 60_000;
      for (const [key, e] of rollup) {
        if (e.bucketMs >= curBucket) continue;
        rollup.delete(key);
        if (e.snaps === 0 || e.prices.size === 0) continue;
        flushed.push({ ...e, prices: new Map(e.prices) });
      }
    }

    // Текущее время: 10:01:30
    const now = new Date("2026-07-19T10:01:30.000Z");

    // Бакет 10:00 (завершён)
    accumulateRollup("BTCUSDT", "binance-futures", new Date("2026-07-19T10:00:15Z"), [
      ["BTCUSDT", "binance-futures", new Date("2026-07-19T10:00:15Z"), 50000, 1, 1],
    ], 50000);

    // Бакет 10:01 (НЕ завершён — now в 10:01:30, бакет 10:01 заканчивается в 10:02)
    accumulateRollup("BTCUSDT", "binance-futures", new Date("2026-07-19T10:01:15Z"), [
      ["BTCUSDT", "binance-futures", new Date("2026-07-19T10:01:15Z"), 50025, 2, 2],
    ], 50025);

    await flushRollup(now);

    assertEqual(flushed.length, 1);
    assertEqual(flushed[0].bucketMs, 1784455200000); // 10:00
    assertEqual(rollup.size, 1);
    const remainingKey = [...rollup.keys()][0];
    assert(remainingKey.includes("1784455260000"), "Остался бакет 10:01");
  })();

  await test("accumulateRollup игнорирует mid===null и пустые rows", async () => {
    const rollup = new Map();
    function accumulateRollup(symbol, exchange, t, rows, mid) {
      if (mid == null || rows.length === 0) return;
      const bucketMs = Math.floor(t.getTime() / 60_000) * 60_000;
      const key = `${symbol}|${exchange}|${bucketMs}`;
      let e = rollup.get(key);
      if (!e) { e = { symbol, exchange, bucketMs, snaps: 0, midSum: 0, prices: new Map() }; rollup.set(key, e); }
      e.snaps += 1; e.midSum += mid;
    }
    const t = new Date("2026-07-19T10:00:00Z");
    accumulateRollup("BTCUSDT", "binance-futures", t, [], 50000); // пустые rows
    accumulateRollup("BTCUSDT", "binance-futures", t, [["x","y",t,50000,1,1]], null); // null mid
    assertEqual(rollup.size, 0);
  })();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: minCoinsFor logic (index.mjs)
// ─────────────────────────────────────────────────────────────────────────────

async function runMinCoinsTests() {
  console.log("\n🧪 minCoinsFor — пороги крупных лимитных ордеров\n");

  await test("возвращает число для известного ключа", async () => {
    const DEFAULT_MIN_COINS = { "BTCUSDT|futures": 500, "ETHUSDT|spot": 1000 };
    const minCoinsMap = new Map(Object.entries(DEFAULT_MIN_COINS));
    function minCoinsFor(symbol, exchange) {
      const v = minCoinsMap.get(`${symbol}|${String(exchange).endsWith("-futures") ? "futures" : "spot"}`);
      if (v === "all") return "all";
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    assertEqual(minCoinsFor("BTCUSDT", "binance-futures"), 500);
    assertEqual(minCoinsFor("ETHUSDT", "binance-spot"), 1000);
  })();

  await test("возвращает null для неизвестного символа (фолбэк на noiseMinNotional)", async () => {
    const minCoinsMap = new Map([["BTCUSDT|futures", 500]]);
    function minCoinsFor(symbol, exchange) {
      const v = minCoinsMap.get(`${symbol}|${String(exchange).endsWith("-futures") ? "futures" : "spot"}`);
      if (v === "all") return "all";
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    assertEqual(minCoinsFor("SOLUSDT", "binance-futures"), null);
  })();

  await test("collectAll = true возвращает 'all'", async () => {
    const minCoinsMap = new Map([["BTCUSDT|futures", "all"]]);
    function minCoinsFor(symbol, exchange) {
      const v = minCoinsMap.get(`${symbol}|${String(exchange).endsWith("-futures") ? "futures" : "spot"}`);
      if (v === "all") return "all";
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    assertEqual(minCoinsFor("BTCUSDT", "binance-futures"), "all");
  })();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("════════════════════════════════════════════════════════════════");
  console.log("  Юнит-тесты коллектора (Node.js, без БД)");
  console.log("════════════════════════════════════════════════════════════════\n");

  await runBinSideTests();
  await runTradeFeedTests();
  await runRollupTests();
  await runMinCoinsTests();

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Всего: ${passed + failed}  ·  ✅ ${passed}  ·  ❌ ${failed}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n[FATAL] ${err.message}`);
  process.exit(1);
});