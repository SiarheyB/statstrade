#!/usr/bin/env node

// Интеграционный тест каскада на НАСТОЯЩЕМ Postgres.
//
// Проверяет главное свойство: часовой (и дневной) бакет всегда содержит ВСЕ
// данные своего периода, сколько бы раз каскад ни прогонялся и куда бы ни
// попадала граница «свежего хвоста».
//
// До правки было наоборот: хвост брался от `MAX(bucket) − 6 часов`, а
// MAX(bucket) — произвольная минута, поэтому крайний час считался по остатку и
// этим обрезком затирал полное значение (ON CONFLICT DO UPDATE SET = EXCLUDED).
// Замер на живой базе: 15 из 518 часов и 16 из 69 суток содержали от 3.9% до
// 65% своих данных.
//
// Работает в отдельной схеме и в конце её сносит — реальные таблицы не трогает.
//
// Запуск:  DATABASE_URL=postgresql://… node collector/cascade-integration.mjs

import pg from "pg";
import { rollupLevel, rollupCascade } from "./cascade.mjs";

const SCHEMA = "cascade_itest";
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Схема-песочница с теми же именами таблиц: запросы каскада ходят по
// неквалифицированным именам, поэтому их резолвит search_path.
const DDL = `
DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;
CREATE SCHEMA ${SCHEMA};
CREATE TABLE ${SCHEMA}."ObSnapshotRollup" (
  symbol text, exchange text, bucket timestamptz(3), price double precision,
  "volSum" double precision DEFAULT 0, "bidSum" double precision DEFAULT 0,
  "askSum" double precision DEFAULT 0,
  PRIMARY KEY (symbol, exchange, bucket, price));
CREATE TABLE ${SCHEMA}."ObRollupBucket" (
  symbol text, exchange text, bucket timestamptz(3),
  snaps int DEFAULT 0, "midSum" double precision DEFAULT 0,
  PRIMARY KEY (symbol, exchange, bucket));
CREATE TABLE ${SCHEMA}."ObSnapshotRollupH" (LIKE ${SCHEMA}."ObSnapshotRollup" INCLUDING ALL);
CREATE TABLE ${SCHEMA}."ObRollupBucketH"  (LIKE ${SCHEMA}."ObRollupBucket"  INCLUDING ALL);
CREATE TABLE ${SCHEMA}."ObSnapshotRollupD" (LIKE ${SCHEMA}."ObSnapshotRollup" INCLUDING ALL);
CREATE TABLE ${SCHEMA}."ObRollupBucketD"  (LIKE ${SCHEMA}."ObRollupBucket"  INCLUDING ALL);
CREATE TABLE ${SCHEMA}."ObFootprintRollup" (
  symbol text, exchange text, bucket timestamptz(3), price double precision,
  "buyVol" double precision DEFAULT 0, "sellVol" double precision DEFAULT 0,
  PRIMARY KEY (symbol, exchange, bucket, price));
CREATE TABLE ${SCHEMA}."ObFootprintRollupH" (LIKE ${SCHEMA}."ObFootprintRollup" INCLUDING ALL);
`;

/** Минутный источник: `minutes` подряд идущих минут от `startIso`. */
async function seedMinutes(pool, startIso, minutes) {
  await pool.query(`TRUNCATE ${SCHEMA}."ObSnapshotRollup", ${SCHEMA}."ObRollupBucket"`);
  await pool.query(
    `INSERT INTO ${SCHEMA}."ObSnapshotRollup" (symbol, exchange, bucket, price, "volSum", "bidSum", "askSum")
     SELECT 'BTCUSDT', 'binance-futures', $1::timestamptz + (g || ' minutes')::interval, 100, 1, 1, 0
     FROM generate_series(0, $2 - 1) g`,
    [startIso, minutes],
  );
  await pool.query(
    `INSERT INTO ${SCHEMA}."ObRollupBucket" (symbol, exchange, bucket, snaps, "midSum")
     SELECT 'BTCUSDT', 'binance-futures', $1::timestamptz + (g || ' minutes')::interval, 30, 3000
     FROM generate_series(0, $2 - 1) g`,
    [startIso, minutes],
  );
}

/** Часы, где свёрнутое значение меньше настоящей суммы источника. */
async function truncatedHours(pool) {
  const { rows } = await pool.query(
    `SELECT h.bucket, h.snaps AS written, src.snaps_true
       FROM ${SCHEMA}."ObRollupBucketH" h
       JOIN (SELECT symbol, exchange, date_trunc('hour', bucket AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS hr,
                    SUM(snaps) AS snaps_true
               FROM ${SCHEMA}."ObRollupBucket" GROUP BY 1,2,3) src
         ON src.symbol = h.symbol AND src.exchange = h.exchange AND src.hr = h.bucket
      WHERE h.snaps <> src.snaps_true
      ORDER BY h.bucket`,
  );
  return rows;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Нужен DATABASE_URL");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  await pool.query(DDL);
  await pool.query(`SET search_path TO ${SCHEMA}, public`);
  // search_path задаётся на соединение, а пул их переиспользует — прибиваем
  // его к пользователю БД, иначе часть запросов уйдёт в public.
  const { rows: who } = await pool.query("SELECT current_user AS u");
  await pool.query(`ALTER ROLE ${who[0].u} SET search_path TO ${SCHEMA}, public`);
  await pool.end();

  const p = new pg.Pool({ connectionString: url, max: 2 });

  console.log("\ncollector/cascade — интеграция\n");

  await test("час собирается ЦЕЛИКОМ, когда MAX(bucket) попадает в середину часа", async () => {
    // 08:00 … 14:37 — последняя минута источника посреди часа, ровно тот
    // случай, на котором ломалось.
    await seedMinutes(p, "2026-08-25T08:00:00Z", 6 * 60 + 38);
    await rollupLevel(p, "ObSnapshotRollup", "ObSnapshotRollupH", "ObRollupBucket", "ObRollupBucketH", "hour", 336, 6);
    const bad = await truncatedHours(p);
    assert(bad.length === 0, `обрезано часов: ${bad.length} — ${JSON.stringify(bad.slice(0, 3))}`);
  });

  await test("час не портится, пока граница хвоста ползёт по нему прогон за прогоном", async () => {
    // Это и был механизм порчи: пока srcHi идёт по часу H+6h, час H
    // переписывается двенадцать раз, каждый раз меньшим куском.
    await seedMinutes(p, "2026-08-25T00:00:00Z", 60);
    for (let extra = 1; extra <= 7 * 60; extra += 5) {
      await p.query(
        `INSERT INTO ${SCHEMA}."ObSnapshotRollup" (symbol, exchange, bucket, price, "volSum", "bidSum", "askSum")
         SELECT 'BTCUSDT','binance-futures', '2026-08-25T01:00:00Z'::timestamptz + (g || ' minutes')::interval, 100, 1, 1, 0
         FROM generate_series(0, $1 - 1) g ON CONFLICT DO NOTHING`,
        [extra],
      );
      await p.query(
        `INSERT INTO ${SCHEMA}."ObRollupBucket" (symbol, exchange, bucket, snaps, "midSum")
         SELECT 'BTCUSDT','binance-futures', '2026-08-25T01:00:00Z'::timestamptz + (g || ' minutes')::interval, 30, 3000
         FROM generate_series(0, $1 - 1) g ON CONFLICT DO NOTHING`,
        [extra],
      );
      await rollupLevel(p, "ObSnapshotRollup", "ObSnapshotRollupH", "ObRollupBucket", "ObRollupBucketH", "hour", 336, 6);
    }
    const bad = await truncatedHours(p);
    assert(bad.length === 0, `обрезано часов: ${bad.length} — ${JSON.stringify(bad.slice(0, 3))}`);
  });

  await test("сутки собираются целиком из часов", async () => {
    // Данных нужно больше, чем хвост (2 суток), и MAX(часового бакета) должен
    // попадать НЕ на полночь — иначе граница хвоста случайно ложится на границу
    // суток и обрезки не возникает даже на старом коде.
    //
    // Здесь 4 суток 13 часов 17 минут: MAX(H) = 08-26T13:00, хвост начинается
    // 08-24T13:00 (середина суток), а порция истории идёт назад до 08-24T13:00 —
    // то есть на старом коде сутки 08-24 писались дважды и оставались с одними
    // часами 00–12.
    await seedMinutes(p, "2026-08-22T00:00:00Z", (4 * 24 + 13) * 60 + 17);
    await rollupCascade(p, { log: { log: () => {}, error: () => {} } });
    const { rows } = await p.query(
      `SELECT d.bucket, d.snaps AS written, src.snaps_true
         FROM ${SCHEMA}."ObRollupBucketD" d
         JOIN (SELECT symbol, exchange, date_trunc('day', bucket AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS dy,
                      SUM(snaps) AS snaps_true
                 FROM ${SCHEMA}."ObRollupBucketH" GROUP BY 1,2,3) src
           ON src.symbol = d.symbol AND src.exchange = d.exchange AND src.dy = d.bucket
        WHERE d.snaps <> src.snaps_true`,
    );
    assert(rows.length === 0, `обрезано суток: ${rows.length} — ${JSON.stringify(rows)}`);
  });

  await test("свёртка идемпотентна: повтор не удваивает суммы", async () => {
    await seedMinutes(p, "2026-08-25T00:00:00Z", 180);
    await rollupLevel(p, "ObSnapshotRollup", "ObSnapshotRollupH", "ObRollupBucket", "ObRollupBucketH", "hour", 336, 6);
    const { rows: a } = await p.query(`SELECT SUM(snaps)::int s FROM ${SCHEMA}."ObRollupBucketH"`);
    await rollupLevel(p, "ObSnapshotRollup", "ObSnapshotRollupH", "ObRollupBucket", "ObRollupBucketH", "hour", 336, 6);
    const { rows: b } = await p.query(`SELECT SUM(snaps)::int s FROM ${SCHEMA}."ObRollupBucketH"`);
    assert(a[0].s === b[0].s, `суммы разъехались: ${a[0].s} → ${b[0].s}`);
  });

  await test("дневной бакет стоит на полуночи UTC при любой таймзоне сессии", async () => {
    // Читающая сторона считает сутки ровно 86 400 000 мс (LEVEL_MS), поэтому
    // бакет обязан быть полуночью UTC, а не полуночью зоны подключения.
    await p.query("SET TimeZone = 'Europe/Moscow'");
    await seedMinutes(p, "2026-08-24T00:00:00Z", 48 * 60);
    await p.query(`TRUNCATE ${SCHEMA}."ObSnapshotRollupH", ${SCHEMA}."ObRollupBucketH",
                            ${SCHEMA}."ObSnapshotRollupD", ${SCHEMA}."ObRollupBucketD"`);
    await rollupCascade(p, { log: { log: () => {}, error: () => {} } });
    const { rows } = await p.query(
      `SELECT bucket FROM ${SCHEMA}."ObRollupBucketD"
        WHERE EXTRACT(hour FROM bucket AT TIME ZONE 'UTC') <> 0
           OR EXTRACT(minute FROM bucket AT TIME ZONE 'UTC') <> 0`,
    );
    await p.query("SET TimeZone = 'UTC'");
    assert(rows.length === 0, `бакеты не на полуночи UTC: ${JSON.stringify(rows)}`);
  });

  await p.query(`ALTER ROLE ${who[0].u} RESET search_path`);
  await p.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  await p.end();

  console.log(`\n  Итого: ${passed} прошло, ${failed} упало\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
