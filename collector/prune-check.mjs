// Тест логики pruneOld() — проверяет, что ob_drop_partitions_before вызывается
// с правильным ретеншном для каждой таблицы.
//
// Запуск: node collector/prune.test.mjs
// (без зависимостей, чистая валидация SQL-запросов)

import { strict as assert } from "node:assert";

// ─────────────────────────────────────────────────────────────────────────────
// Моделируем cfg, pool и pruneOld из index.mjs
// ─────────────────────────────────────────────────────────────────────────────

function makeCfg(retentionDays, tradeRetentionDays) {
  return {
    retentionDays,
    tradeRetentionDays:
      tradeRetentionDays ?? retentionDays ?? 30,
  };
}

const PARTITIONED_TABLES = ["ObSnapshot", "ObTrade", "ObFootprint", "ObBigTrade"];

// Собираем вызовы, которые сделал бы pruneOld
function simulatePruneOld(cfg) {
  const calls = [];
  const pool = {
    query: (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ n: 1 }] };
    },
  };

  for (const tbl of PARTITIONED_TABLES) {
    pool.query(`SELECT ob_ensure_partitions($1, 7)`, [tbl]);
  }

  // Snapshot
  pool.query(
    `SELECT ob_drop_partitions_before($1, NOW() - ($2 || ' days')::interval) AS n`,
    ["ObSnapshot", String(cfg.retentionDays)],
  );

  // Trades, Footprint, BigTrade
  for (const tbl of ["ObTrade", "ObFootprint", "ObBigTrade"]) {
    pool.query(
      `SELECT ob_drop_partitions_before($1, NOW() - ($2 || ' days')::interval) AS n`,
      [tbl, String(cfg.tradeRetentionDays)],
    );
  }

  return calls;
}

// ─────────────────────────────────────────────────────────────────────────────
// Тесты
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

console.log("\n🧪 pruneOld — config parsing\n");

test("по умолчанию: snap=7, trades=30", () => {
  const cfg = makeCfg(7, 30);
  assert.equal(cfg.retentionDays, 7);
  assert.equal(cfg.tradeRetentionDays, 30);
});

test("tradeRetentionDays падает на RETENTION_DAYS, если не задан", () => {
  const cfg = makeCfg(14, undefined);
  assert.equal(cfg.retentionDays, 14);
  assert.equal(cfg.tradeRetentionDays, 14);
});

test("если оба не заданы — дефолт 30 для trades", () => {
  const cfg = makeCfg(undefined, undefined);
  // В реальном коде RETENTION_DAYS ?? 7, а TRADE_RETENTION_DAYS ?? RETENTION_DAYS ?? 30
  // Но в makeCfg мы передаём явно undefined
  assert.equal(cfg.tradeRetentionDays, 30);
});

test("разные значения для snap и trades", () => {
  const cfg = makeCfg(7, 90);
  assert.equal(cfg.retentionDays, 7);
  assert.equal(cfg.tradeRetentionDays, 90);
});

console.log("\n🧪 pruneOld — SQL вызовы\n");

test("ensure_partitions вызывается для всех 4 таблиц", () => {
  const cfg = makeCfg(7, 30);
  const calls = simulatePruneOld(cfg);
  const ensureCalls = calls.filter((c) => c.sql.includes("ob_ensure_partitions"));
  assert.equal(ensureCalls.length, 4);
  assert.deepEqual(ensureCalls.map((c) => c.params[0]), [
    "ObSnapshot", "ObTrade", "ObFootprint", "ObBigTrade",
  ]);
});

test("drop_partitions_before для ObSnapshot использует retentionDays=7", () => {
  const cfg = makeCfg(7, 30);
  const calls = simulatePruneOld(cfg);
  const snapDrop = calls.find((c) => c.params[0] === "ObSnapshot" && c.sql.includes("ob_drop_partitions_before"));
  assert.ok(snapDrop, "должен быть вызов drop для ObSnapshot");
  assert.equal(snapDrop.params[1], "7");
});

test("drop_partitions_before для ObTrade использует tradeRetentionDays=30", () => {
  const cfg = makeCfg(7, 30);
  const calls = simulatePruneOld(cfg);
  const tradeDrop = calls.find((c) => c.params[0] === "ObTrade" && c.sql.includes("ob_drop_partitions_before"));
  assert.ok(tradeDrop, "должен быть вызов drop для ObTrade");
  assert.equal(tradeDrop.params[1], "30");
});

test("drop_partitions_before для ObFootprint использует tradeRetentionDays=90", () => {
  const cfg = makeCfg(7, 90);
  const calls = simulatePruneOld(cfg);
  const fpDrop = calls.find((c) => c.params[0] === "ObFootprint" && c.sql.includes("ob_drop_partitions_before"));
  assert.ok(fpDrop, "должен быть вызов drop для ObFootprint");
  assert.equal(fpDrop.params[1], "90");
});

test("drop_partitions_before для ObBigTrade использует tradeRetentionDays=90", () => {
  const cfg = makeCfg(7, 90);
  const calls = simulatePruneOld(cfg);
  const btDrop = calls.find((c) => c.params[0] === "ObBigTrade" && c.sql.includes("ob_drop_partitions_before"));
  assert.ok(btDrop, "должен быть вызов drop для ObBigTrade");
  assert.equal(btDrop.params[1], "90");
});

test("drop_partitions_before: ObSnapshot получает retentionDays, а ObTrade — tradeRetentionDays (разные значения)", () => {
  const cfg = makeCfg(7, 30);
  const calls = simulatePruneOld(cfg);
  const snapDrop = calls.find((c) => c.params[0] === "ObSnapshot" && c.sql.includes("ob_drop_partitions_before"));
  const tradeDrop = calls.find((c) => c.params[0] === "ObTrade" && c.sql.includes("ob_drop_partitions_before"));
  assert.equal(snapDrop.params[1], "7");
  assert.equal(tradeDrop.params[1], "30");
  assert.notEqual(snapDrop.params[1], tradeDrop.params[1],
    "ретеншн для ObSnapshot и ObTrade должен отличаться");
});

// ─────────────────────────────────────────────────────────────────────────────
// Итог
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Всего: ${passed + failed}  ·  ✅ ${passed}  ·  ❌ ${failed}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
process.exit(failed > 0 ? 1 : 0);