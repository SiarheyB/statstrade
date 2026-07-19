#!/usr/bin/env node

// Интеграционный тест: проверяет, что ob_drop_partitions_before
// удаляет партиции старше cutoff и оставляет новые.
//
// Требует: Docker (для временного Postgres-контейнера).
// Запуск:   node collector/prune-integration.mjs
//
// Опционально: можно указать DATABASE_URL для подключения к существующей БД
//   DATABASE_URL=postgresql://... node collector/prune-integration.mjs

import { execSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = resolve(__dirname, "../prisma/migrations/20260704090000_partition_ob_tables/migration.sql");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let containerName = null;

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

async function setupPostgres() {
  // Если задан DATABASE_URL — используем его (для CI или локальной БД)
  if (process.env.DATABASE_URL) {
    console.log(`[setup] используем DATABASE_URL: ${process.env.DATABASE_URL}`);
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    // Проверяем связь
    await pool.query("SELECT 1");
    return { pool, cleanup: () => pool.end() };
  }

  // Иначе — поднимаем временный Docker-контейнер
  const hash = createHash("md5").update(String(Date.now())).digest("hex").slice(0, 8);
  containerName = `prune-test-${hash}`;
  console.log(`[setup] запускаем Postgres: ${containerName}`);

  try {
    execSync(
      `docker run -d --name ${containerName} ` +
        `-e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test ` +
        `-p 0:5432 postgres:16-alpine`,
      { stdio: "pipe", timeout: 30000 },
    );
  } catch (err) {
    throw new Error(`Не удалось запустить Docker-контейнер: ${err.stderr?.toString() || err.message}`);
  }

  // Даём контейнеру время на запуск
  await sleep(3000);

  // Получаем порт (берём только первую строку — IPv4)
  let port;
  try {
    const portStr = execSync(`docker port ${containerName} 5432`, { encoding: "utf8", timeout: 5000 }).trim();
    const firstLine = portStr.split("\n")[0].trim();
    port = firstLine.split(":")[1] || "5432";
  } catch (err) {
    throw new Error(`Не удалось получить порт контейнера: ${err.message}`);
  }
  const url = `postgresql://test:test@localhost:${port}/test`;

  // Ждём, пока Postgres поднимется
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query("SELECT 1");
      console.log(`[setup] Postgres готов на localhost:${port}`);
      return {
        pool,
        url,
        cleanup: async () => {
          await pool.end();
          try {
            execSync(`docker rm -f ${containerName}`, { stdio: "pipe", timeout: 10000 });
          } catch { /* ignore */ }
        },
      };
    } catch {
      await sleep(500);
    }
  }
  throw new Error("Postgres не поднялся за 15 секунд");
}

async function applyMigration(pool) {
  // Применяем только функции обслуживания (не данные — таблицы создадим сами)
  const sql = readFileSync(MIGRATION_SQL, "utf8");

  // Извлекаем функции: ищем CREATE OR REPLACE FUNCTION ob_...,
  // определяем долларовый тег (между AS $ и $), ищем закрывающий тег и ';' после него.
  const funcs = [];
  let pos = 0;
  while (true) {
    const start = sql.indexOf("CREATE OR REPLACE FUNCTION ob_", pos);
    if (start === -1) break;

    const asIdx = sql.indexOf("AS $", start);
    if (asIdx === -1) { pos = start + 1; continue; }

    const tagStart = asIdx + 4; // "AS $" + первый символ тега
    const tagEnd = sql.indexOf("$", tagStart);
    if (tagEnd === -1) { pos = start + 1; continue; }

    const tag = sql.slice(tagStart, tagEnd); // "fn" из "$fn$"
    const closeTag = "$" + tag + "$";

    const closePos = sql.indexOf(closeTag, tagEnd + 1);
    if (closePos === -1) { pos = start + 1; continue; }

    const endPos = sql.indexOf(";", closePos + closeTag.length);
    if (endPos === -1) { pos = start + 1; continue; }

    funcs.push(sql.slice(start, endPos + 1));
    pos = endPos + 1;
  }

  if (funcs.length === 0) {
    throw new Error("Не удалось извлечь SQL-функции из migration.sql");
  }

  for (const fn of funcs) {
    await pool.query(fn);
  }
  console.log(`[setup] применено ${funcs.length} SQL-функций`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Тесты
// ─────────────────────────────────────────────────────────────────────────────

async function runTests(pool) {
  console.log("\n🧪 ob_drop_partitions_before — интеграционные тесты\n");

  // ── Тест 1: создаём партиционированную таблицу и партиции ──
  await test("создаёт партиции и удаляет старые по cutoff", async () => {
    // Создаём партиционированную таблицу (не TEMP — иначе нельзя создать
    // постоянные партиции как PARTITION OF временной таблицы)
    await pool.query(`DROP TABLE IF EXISTS test_ob_drop CASCADE`);
    await pool.query(`
      CREATE TABLE test_ob_drop (
        id BIGSERIAL,
        t TIMESTAMPTZ(3) NOT NULL
      ) PARTITION BY RANGE (t)
    `);
    await pool.query(`CREATE TABLE test_ob_drop_default PARTITION OF test_ob_drop DEFAULT`);

    // Создаём партиции на 3 дня:
    // test_ob_drop_p20260701 — данные от 2026-07-01 до 2026-07-02
    // test_ob_drop_p20260702 — данные от 2026-07-02 до 2026-07-03
    // test_ob_drop_p20260703 — данные от 2026-07-03 до 2026-07-04
    await pool.query(`
      CREATE TABLE test_ob_drop_p20260701 PARTITION OF test_ob_drop
      FOR VALUES FROM ('2026-07-01') TO ('2026-07-02')
    `);
    await pool.query(`
      CREATE TABLE test_ob_drop_p20260702 PARTITION OF test_ob_drop
      FOR VALUES FROM ('2026-07-02') TO ('2026-07-03')
    `);
    await pool.query(`
      CREATE TABLE test_ob_drop_p20260703 PARTITION OF test_ob_drop
      FOR VALUES FROM ('2026-07-03') TO ('2026-07-04')
    `);

    // Проверяем, что все 3 партиции + default существуют
    const before = await pool.query(`
      SELECT c.relname
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'test_ob_drop'::regclass
      ORDER BY c.relname
    `);
    const namesBefore = before.rows.map((r) => r.relname).sort();
    const expectedBefore = [
      "test_ob_drop_default",
      "test_ob_drop_p20260701",
      "test_ob_drop_p20260702",
      "test_ob_drop_p20260703",
    ];
    if (JSON.stringify(namesBefore) !== JSON.stringify(expectedBefore)) {
      throw new Error(
        `Перед удалением ожидалось ${JSON.stringify(expectedBefore)}, получено ${JSON.stringify(namesBefore)}`,
      );
    }

    // Вызываем drop для cutoff = '2026-07-02' (партиции ДО 2 июля)
    // Должны удалиться: p20260701 (hi = 2026-07-02 <= cutoff)
    // Должны остаться: p20260702 (hi = 2026-07-03 > cutoff), p20260703 (hi = 2026-07-04 > cutoff)
    const r = await pool.query(
      `SELECT ob_drop_partitions_before('test_ob_drop', '2026-07-02'::timestamptz) AS n`,
    );
    const dropped = r.rows[0]?.n ?? 0;
    if (dropped !== 1) {
      throw new Error(`Ожидалось 1 удалённая партиция, получено ${dropped}`);
    }

    // Проверяем, что осталось
    const after = await pool.query(`
      SELECT c.relname
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'test_ob_drop'::regclass
      ORDER BY c.relname
    `);
    const namesAfter = after.rows.map((r) => r.relname).sort();
    const expectedAfter = [
      "test_ob_drop_default",
      "test_ob_drop_p20260702",
      "test_ob_drop_p20260703",
    ];
    if (JSON.stringify(namesAfter) !== JSON.stringify(expectedAfter)) {
      throw new Error(
        `После удаления ожидалось ${JSON.stringify(expectedAfter)}, получено ${JSON.stringify(namesAfter)}`,
      );
    }

    // Проверяем, что партиция p20260701 реально удалена (не существует в pg_class)
    const check = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'test_ob_drop_p20260701') AS exists`,
    );
    if (check.rows[0].exists) {
      throw new Error("Партиция test_ob_drop_p20260701 должна быть удалена, но она существует");
    }
  })();

  // ── Тест 2: DEFAULT-партиция не удаляется ──
  await test("не удаляет DEFAULT-партицию", async () => {
    await pool.query(`DROP TABLE IF EXISTS test_default_safe CASCADE`);
    await pool.query(`
      CREATE TABLE test_default_safe (
        id BIGSERIAL,
        t TIMESTAMPTZ(3) NOT NULL
      ) PARTITION BY RANGE (t)
    `);
    await pool.query(`CREATE TABLE test_default_safe_default PARTITION OF test_default_safe DEFAULT`);
    await pool.query(`
      CREATE TABLE test_default_safe_p20260705 PARTITION OF test_default_safe
      FOR VALUES FROM ('2026-07-05') TO ('2026-07-06')
    `);

    // cutoff игнорирует DEFAULT — должен быть 0 удалённых партиций
    const r = await pool.query(
      `SELECT ob_drop_partitions_before('test_default_safe', '2026-07-10'::timestamptz) AS n`,
    );
    const dropped = r.rows[0]?.n ?? 0;

    // p20260705 (hi = 2026-07-06) <= cutoff (2026-07-10) → должна удалиться
    // default — не трогается
    if (dropped !== 1) {
      throw new Error(`Ожидалось 1 удалённая партиция (p20260705), получено ${dropped}`);
    }

    // Проверяем, что default осталась
    const check = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'test_default_safe_default') AS exists`,
    );
    if (!check.rows[0].exists) {
      throw new Error("DEFAULT-партиция не должна удаляться");
    }
  })();

  // ── Тест 3: cutoff в середине дня — удаляет только целиком меньшие ──
  await test("удаляет только партиции, целиком лежащие до cutoff", async () => {
    await pool.query(`DROP TABLE IF EXISTS test_mid_cutoff CASCADE`);
    await pool.query(`
      CREATE TABLE test_mid_cutoff (
        id BIGSERIAL,
        t TIMESTAMPTZ(3) NOT NULL
      ) PARTITION BY RANGE (t)
    `);
    await pool.query(`CREATE TABLE test_mid_cutoff_default PARTITION OF test_mid_cutoff DEFAULT`);
    // p20260710: hi = 2026-07-11
    await pool.query(`
      CREATE TABLE test_mid_cutoff_p20260710 PARTITION OF test_mid_cutoff
      FOR VALUES FROM ('2026-07-10') TO ('2026-07-11')
    `);
    // p20260711: hi = 2026-07-12
    await pool.query(`
      CREATE TABLE test_mid_cutoff_p20260711 PARTITION OF test_mid_cutoff
      FOR VALUES FROM ('2026-07-11') TO ('2026-07-12')
    `);

    // cutoff = 2026-07-11 15:00:00
    // p20260710: hi = 2026-07-11 <= 2026-07-11 15:00 → удаляется
    // p20260711: hi = 2026-07-12 > 2026-07-11 15:00 → остаётся
    const r = await pool.query(
      `SELECT ob_drop_partitions_before('test_mid_cutoff', '2026-07-11T15:00:00Z'::timestamptz) AS n`,
    );
    const dropped = r.rows[0]?.n ?? 0;
    if (dropped !== 1) {
      throw new Error(`Ожидалось 1 удалённая партиция, получено ${dropped}`);
    }

    const check = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'test_mid_cutoff_p20260710') AS exists`,
    );
    if (check.rows[0].exists) {
      throw new Error("test_mid_cutoff_p20260710 должна быть удалена");
    }
    const check2 = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'test_mid_cutoff_p20260711') AS exists`,
    );
    if (!check2.rows[0].exists) {
      throw new Error("test_mid_cutoff_p20260711 должна остаться");
    }
  })();

  // ── Тест 4: симуляция реального сценария с ObTrade ──
  await test("симуляция: ObTrade — удаление старой партиции по retention", async () => {
    // Создаём таблицу, похожую на ObTrade (партиционированная)
    await pool.query(`DROP TABLE IF EXISTS test_ob_trade CASCADE`);
    await pool.query(`
      CREATE TABLE test_ob_trade (
        id BIGSERIAL,
        symbol TEXT NOT NULL,
        exchange TEXT NOT NULL,
        t TIMESTAMPTZ(3) NOT NULL,
        "buyVol" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "sellVol" DOUBLE PRECISION NOT NULL DEFAULT 0
      ) PARTITION BY RANGE (t)
    `);
    await pool.query(`CREATE TABLE test_ob_trade_default PARTITION OF test_ob_trade DEFAULT`);

    // Создаём партиции: 20 июня (старая) и 19 июля (сегодняшняя)
    await pool.query(`
      CREATE TABLE test_ob_trade_p20260620 PARTITION OF test_ob_trade
      FOR VALUES FROM ('2026-06-20') TO ('2026-06-21')
    `);
    await pool.query(`
      CREATE TABLE test_ob_trade_p20260719 PARTITION OF test_ob_trade
      FOR VALUES FROM ('2026-07-19') TO ('2026-07-20')
    `);

    // Сохраняем текущие данные в партиции (имитация записи)
    await pool.query(`
      INSERT INTO test_ob_trade ("symbol", "exchange", "t", "buyVol", "sellVol")
      SELECT 'BTCUSDT', 'binance-futures', generate_series(
        '2026-07-19T10:00:00Z'::timestamptz,
        '2026-07-19T10:05:00Z'::timestamptz,
        interval '1 minute'
      ), 10, 5
    `);

    // "Сегодня" 19 июля, retention = 7 дней
    // cutoff = 2026-07-19 - 7 = 2026-07-12
    // p20260620: hi = 2026-06-21 <= 2026-07-12 → удаляется
    // p20260719: hi = 2026-07-20 > 2026-07-12 → остаётся
    const r = await pool.query(
      `SELECT ob_drop_partitions_before('test_ob_trade', '2026-07-12'::timestamptz) AS n`,
    );
    const dropped = r.rows[0]?.n ?? 0;
    if (dropped !== 1) {
      throw new Error(`Ожидалось 1 удалённая партиция, получено ${dropped}`);
    }

    // Проверяем, что старая партиция удалена
    const checkOld = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'test_ob_trade_p20260620') AS exists`,
    );
    if (checkOld.rows[0].exists) {
      throw new Error("Старая партиция p20260620 должна быть удалена");
    }

    // Проверяем, что сегодняшняя партиция осталась
    const checkToday = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'test_ob_trade_p20260719') AS exists`,
    );
    if (!checkToday.rows[0].exists) {
      throw new Error("Сегодняшняя партиция p20260719 должна остаться");
    }

    // Проверяем, что данные в сегодняшней партиции целы
    const data = await pool.query(
      `SELECT count(*)::int AS n FROM test_ob_trade WHERE "t" >= '2026-07-19'`,
    );
    if (data.rows[0].n < 5) {
      throw new Error(`Ожидалось >= 5 строк в сегодняшней партиции, получено ${data.rows[0].n}`);
    }
  })();

  // ── Тест 5: DROP удалённой партиции — ошибка не возникает ──
  await test("DROP уже удалённой партиции — идемпотентность", async () => {
    await pool.query(`DROP TABLE IF EXISTS test_idempotent CASCADE`);
    // Создаём таблицу с одной партицией
    await pool.query(`
      CREATE TABLE test_idempotent (
        id BIGSERIAL,
        t TIMESTAMPTZ(3) NOT NULL
      ) PARTITION BY RANGE (t)
    `);
    await pool.query(`
      CREATE TABLE test_idempotent_p20260701 PARTITION OF test_idempotent
      FOR VALUES FROM ('2026-07-01') TO ('2026-07-02')
    `);
    await pool.query(`CREATE TABLE test_idempotent_default PARTITION OF test_idempotent DEFAULT`);

    // Первый вызов — удаляет 1 партицию
    const r1 = await pool.query(
      `SELECT ob_drop_partitions_before('test_idempotent', '2026-07-10'::timestamptz) AS n`,
    );
    if (r1.rows[0].n !== 1) {
      throw new Error(`Первый вызов: ожидалось 1, получено ${r1.rows[0].n}`);
    }

    // Второй вызов — ничего не удаляет (партиции уже нет)
    const r2 = await pool.query(
      `SELECT ob_drop_partitions_before('test_idempotent', '2026-07-10'::timestamptz) AS n`,
    );
    if (r2.rows[0].n !== 0) {
      throw new Error(`Второй вызов: ожидалось 0, получено ${r2.rows[0].n}`);
    }
  })();
  // Cleanup test tables
  await pool.query(`DROP TABLE IF EXISTS test_ob_drop CASCADE`);
  await pool.query(`DROP TABLE IF EXISTS test_default_safe CASCADE`);
  await pool.query(`DROP TABLE IF EXISTS test_mid_cutoff CASCADE`);
  await pool.query(`DROP TABLE IF EXISTS test_ob_trade CASCADE`);
  await pool.query(`DROP TABLE IF EXISTS test_idempotent CASCADE`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Интеграционный тест ob_drop_partitions_before");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const { pool, cleanup } = await setupPostgres();

  try {
    await applyMigration(pool);
    await runTests(pool);
  } finally {
    await cleanup();
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Всего: ${passed + failed}  ·  ✅ ${passed}  ·  ❌ ${failed}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n[FATAL] ${err.message}`);
  if (containerName) {
    try { execSync(`docker rm -f ${containerName}`, { stdio: "pipe" }); } catch { /* ignore */ }
  }
  process.exit(1);
});