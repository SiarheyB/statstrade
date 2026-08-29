#!/usr/bin/env node

// Разовое лечение агрегатов карты ордеров, испорченных невыровненными
// границами каскада (см. collector/cascade.mjs, ALIGNED_RANGE).
//
// ЧТО БЫЛО. Хвост свёртки брался от `MAX(bucket) − N периодов`, а MAX(bucket) —
// произвольная минута. Крайний период считался по остатку и затирал им ранее
// посчитанное полное значение (ON CONFLICT DO UPDATE SET = EXCLUDED). Обратный
// проход по истории идёт от MIN(dst) назад и до испорченного периода уже не
// доходит — обрезок оставался навсегда.
//
// ЧТО ДЕЛАЕТ СКРИПТ. Пересчитывает часовой уровень из минутного и дневной из
// часового — по всей глубине, порциями по суткам (одна гигантская транзакция
// на мини-ПК не нужна). Свёртка идемпотентна, поэтому повторный запуск
// безопасен.
//
// ЧЕГО НЕ МОЖЕТ. Часы, чей минутный слой уже удалён ретеншном
// (ROLLUP_MINUTE_RETENTION_DAYS, по умолчанию 30 суток), восстановить не из
// чего — они останутся такими, какие есть. Это ещё один довод накатывать
// правку не откладывая.
//
// Запуск на сервере (pg лежит в образе коллектора, поэтому именно он):
//   docker compose -f docker-compose.prod.yml exec -T collector \
//     node repair-cascade.mjs
// Сначала стоит посмотреть масштаб, ничего не меняя:
//   docker compose -f docker-compose.prod.yml exec -T collector \
//     node repair-cascade.mjs --dry-run

import pg from "pg";
import { rollupRange } from "./cascade.mjs";

const DRY = process.argv.includes("--dry-run");
const DAY_MS = 86_400_000;

const LEVELS = [
  {
    unit: "hour",
    srcPrices: "ObSnapshotRollup", dstPrices: "ObSnapshotRollupH",
    srcSnaps: "ObRollupBucket", dstSnaps: "ObRollupBucketH",
    label: "часовой уровень (из минутного)",
  },
  {
    unit: "day",
    srcPrices: "ObSnapshotRollupH", dstPrices: "ObSnapshotRollupD",
    srcSnaps: "ObRollupBucketH", dstSnaps: "ObRollupBucketD",
    label: "дневной уровень (из часового)",
  },
];

/** Сколько бакетов уровня расходится с суммой источника и насколько сильно. */
async function damage(pool, lvl) {
  const { rows } = await pool.query(
    `WITH src AS (
       SELECT symbol, exchange,
              date_trunc($1, bucket AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS bkt,
              SUM(snaps) AS snaps_true
         FROM "${lvl.srcSnaps}" GROUP BY 1,2,3)
     SELECT count(*)::int AS total,
            count(*) FILTER (WHERE d.snaps <> src.snaps_true)::int AS broken,
            COALESCE(round(min(100.0 * d.snaps / NULLIF(src.snaps_true,0))
                     FILTER (WHERE d.snaps <> src.snaps_true), 1), 0) AS worst_pct
       FROM "${lvl.dstSnaps}" d
       JOIN src ON src.symbol = d.symbol AND src.exchange = d.exchange AND src.bkt = d.bucket`,
    [lvl.unit],
  );
  return rows[0] ?? { total: 0, broken: 0, worst_pct: 0 };
}

async function repair(pool, lvl) {
  const { rows } = await pool.query(
    `SELECT MIN("bucket") AS lo, MAX("bucket") AS hi FROM "${lvl.srcSnaps}"`,
  );
  const lo = rows[0]?.lo && new Date(rows[0].lo);
  const hi = rows[0]?.hi && new Date(rows[0].hi);
  if (!lo || !hi) {
    console.log(`  источник пуст — нечего пересчитывать`);
    return 0;
  }

  // Порциями по суткам: границы всё равно доводит до целых периодов сама
  // rollupRange, а транзакция остаётся короткой.
  let written = 0;
  let chunks = 0;
  const total = Math.max(1, Math.ceil((hi.getTime() - lo.getTime()) / DAY_MS));
  for (let t = lo.getTime(); t <= hi.getTime(); t += DAY_MS) {
    written += await rollupRange(
      pool, lvl.srcPrices, lvl.dstPrices, lvl.srcSnaps, lvl.dstSnaps,
      lvl.unit, new Date(t), new Date(Math.min(t + DAY_MS, hi.getTime() + DAY_MS)),
    );
    chunks++;
    if (chunks % 10 === 0) process.stdout.write(`\r  порций: ${chunks}/${total}`);
  }
  process.stdout.write(`\r  порций: ${chunks}/${total}\n`);
  return written;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Нужен DATABASE_URL");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url, max: 2 });

  for (const lvl of LEVELS) {
    console.log(`\n${lvl.label}`);
    const before = await damage(pool, lvl);
    console.log(
      `  до:    бакетов ${before.total}, испорчено ${before.broken}` +
      (before.broken ? `, худший содержит ${before.worst_pct}% своих данных` : ""),
    );

    if (DRY) continue;
    if (before.broken === 0) {
      console.log("  чинить нечего — пропускаем");
      continue;
    }

    const written = await repair(pool, lvl);
    const after = await damage(pool, lvl);
    console.log(`  после: бакетов ${after.total}, испорчено ${after.broken} (записано строк цен: ${written})`);
    if (after.broken > 0) {
      console.log(
        `  осталось ${after.broken} — это периоды, чей источник уже вычищен ретеншном;` +
        ` восстановить их не из чего`,
      );
    }
  }

  await pool.end();
  console.log(DRY ? "\nПрогон вхолостую — ничего не менялось.\n" : "\nГотово.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
