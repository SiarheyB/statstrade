// Каскад агрегатов стакана: час и сутки поверх минутного rollup, плюс часовой
// футпринт поверх пятиминутного.
//
// Зачем (см. ORDERFLOW_PERF_PLAN.md §4): окно карты на старших таймфреймах —
// месяцы и годы, а колонок на графике всегда 240. На "1d" колонка шириной 36
// часов, и складывать в неё 2160 минутных строк незачем: результат тот же, что
// у одной дневной. Минутный уровень при этом остаётся полным.
//
// Свёртка идемпотентна: повторный прогон того же периода ПЕРЕЗАПИСЫВАЕТ суммы
// (DO UPDATE SET = EXCLUDED), а не прибавляет их. Поэтому её можно гонять по
// расписанию, не отслеживая, что уже посчитано, и безопасно пересчитывать
// период заново, если в минутный уровень задним числом доехали данные.
//
// Отдельный модуль (а не тело index.mjs), чтобы это покрывалось тестами: импорт
// index.mjs поднимает пул соединений и HTTP-сервер. Тот же приём, что с
// prune.mjs — pool приходит аргументом.

/** Порция периодов за один прогон: первый проход по годовой истории иначе
 *  стал бы одной гигантской транзакцией на слабом сервере. */
export const CASCADE_CHUNK_HOURS = 24 * 14;
export const CASCADE_CHUNK_DAYS = 90;
/** Свежий хвост, который закрывается на каждом прогоне до разбора истории. */
export const CASCADE_TAIL_HOURS = 6;
export const CASCADE_TAIL_DAYS = 2;

export function unitMs(unit) {
  return unit === "day" ? 86_400_000 : 3600_000;
}

/**
 * Обрезка времени до начала периода — ЖЁСТКО В UTC.
 *
 * Это не таймзона пользователя и не таймзона сессии БД. Бакет rollup — не
 * календарные сутки, а ячейка сетки агрегации по абсолютному времени: таблица
 * одна на всех, её одновременно читают из разных часовых поясов, а колонки
 * карты считаются из чистых эпоха-миллисекунд (colExpr в lib/orderflow.ts).
 * Таймзона пользователя (ts_timezone) накладывается на ОТРИСОВКЕ — подписи оси
 * времени, перекрестье, лента сделок (drawTimeGrid / fmtCrosshairLabel).
 *
 * Голый `date_trunc(unit, ts)` режет в таймзоне СЕССИИ. При не-UTC сессии
 * дневной бакет уехал бы на её смещение, а в зоне с переходом на летнее время
 * сутки стали бы 23 и 25 часов — читающая сторона при этом жёстко полагает их
 * равными 86 400 000 мс (LEVEL_MS в lib/orderflow.ts), и сетка колонок
 * разъехалась бы с бакетами.
 */
export const truncUtc = (expr, unitParam = "$3") =>
  `(date_trunc(${unitParam}, (${expr}) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;

/**
 * Границы диапазона свёртки, доведённые до ЦЕЛЫХ периодов.
 *
 * КЛЮЧЕВОЕ УСЛОВИЕ КОРРЕКТНОСТИ. Свёртка пишет `ON CONFLICT DO UPDATE
 * SET = EXCLUDED`, то есть перезаписывает значение, а не прибавляет к нему.
 * Если диапазон начинается посреди часа, крайний час считается по его остатку —
 * и этим обрезком затирается ранее посчитанное полное значение. Обратный проход
 * по истории идёт от MIN(dst) назад и до испорченного часа уже не доходит:
 * обрезок остаётся навсегда.
 *
 * Так и было: хвост брался от `MAX(bucket) − 6 часов`, а MAX(bucket) — это
 * произвольная минута. Замер на живой базе перед правкой: 15 из 518 часов и
 * 16 из 69 суток содержали от 3.9% до 65% своих данных.
 *
 * lo опускается вниз, hi поднимается вверх: период, задетый диапазоном хотя бы
 * частично, входит в него целиком.
 */
export const ALIGNED_RANGE = `
  SELECT ${truncUtc("$1::timestamptz")} AS lo,
         CASE WHEN $2::timestamptz = ${truncUtc("$2::timestamptz")}
              THEN $2::timestamptz
              ELSE ${truncUtc("$2::timestamptz")} + ('1 ' || $3)::interval
         END AS hi`;

/**
 * Свернуть один уровень каскада за диапазон [lo, hi).
 *
 * Диапазон приходит снаружи «сырым» (см. rollupLevel) — до целых периодов его
 * доводит ALIGNED_RANGE здесь же, одним и тем же выражением с группировкой.
 *
 * @returns сколько строк цен записано
 */
export async function rollupRange(pool, srcPrices, dstPrices, srcSnaps, dstSnaps, unit, lo, hi) {
  if (!lo || !hi || lo >= hi) return 0;

  const { rowCount } = await pool.query(
    `WITH b AS (${ALIGNED_RANGE})
     INSERT INTO "${dstPrices}" ("symbol","exchange","bucket","price","volSum","bidSum","askSum")
     SELECT s."symbol", s."exchange", ${truncUtc('s."bucket"')} AS bkt, s."price",
            SUM(s."volSum"), SUM(s."bidSum"), SUM(s."askSum")
     FROM "${srcPrices}" s, b
     WHERE s."bucket" >= b.lo AND s."bucket" < b.hi
     GROUP BY s."symbol", s."exchange", bkt, s."price"
     ON CONFLICT ("symbol","exchange","bucket","price")
     DO UPDATE SET "volSum" = EXCLUDED."volSum",
                   "bidSum" = EXCLUDED."bidSum",
                   "askSum" = EXCLUDED."askSum"`,
    [lo, hi, unit],
  );

  // Счётчики снапшотов — ТЕМ ЖЕ окном: из них computeOrderflow берёт нормировку
  // (число бирж / число снапшотов в колонке), и разъехавшись с ценами она
  // исказила бы яркость карты.
  await pool.query(
    `WITH b AS (${ALIGNED_RANGE})
     INSERT INTO "${dstSnaps}" ("symbol","exchange","bucket","snaps","midSum")
     SELECT s."symbol", s."exchange", ${truncUtc('s."bucket"')} AS bkt,
            SUM(s."snaps")::int, SUM(s."midSum")
     FROM "${srcSnaps}" s, b
     WHERE s."bucket" >= b.lo AND s."bucket" < b.hi
     GROUP BY s."symbol", s."exchange", bkt
     ON CONFLICT ("symbol","exchange","bucket")
     DO UPDATE SET "snaps" = EXCLUDED."snaps", "midSum" = EXCLUDED."midSum"`,
    [lo, hi, unit],
  );

  return rowCount ?? 0;
}

/**
 * Один уровень каскада: свежий хвост + порция истории.
 *
 * Порядок именно такой, потому что каскад догоняет историю не за один прогон.
 * Правый край карты — то, ради чего на неё смотрят, — должен быть свёрнут
 * ВСЕГДА, поэтому хвост закрывается первым, а история идёт НАЗАД от уже
 * свёрнутого края (MIN(dst)) к началу источника. Обратный порядок (вперёд от
 * MAX(dst)) не работает: свёрнутый хвост сам становится максимумом, и история
 * не разбирается никогда.
 *
 * MIN/MAX спрашиваем у таблиц СЧЁТЧИКОВ, а не цен: диапазон бакетов у них тот
 * же, а строк на два порядка меньше (одна на бакет против сотни на цены). По
 * таблице цен это Seq Scan на гигабайты — btree по bucket там снят намеренно
 * (миграция orderflow_index_diet), а BRIN на MIN/MAX не отвечает.
 */
export async function rollupLevel(pool, srcPrices, dstPrices, srcSnaps, dstSnaps, unit, chunk, tail) {
  const step = unitMs(unit);
  const { rows } = await pool.query(
    `SELECT (SELECT MIN("bucket") FROM "${srcSnaps}") AS src_lo,
            (SELECT MAX("bucket") FROM "${srcSnaps}") AS src_hi,
            (SELECT MIN("bucket") FROM "${dstSnaps}") AS dst_lo`,
  );
  const srcLo = rows[0]?.src_lo && new Date(rows[0].src_lo);
  const srcHi = rows[0]?.src_hi && new Date(rows[0].src_hi);
  if (!srcLo || !srcHi) return 0; // источник пуст — сворачивать нечего

  // 1. Свежий хвост: последние `tail` периодов источника. Верхняя граница — за
  //    концом данных, чтобы текущий незавершённый период тоже попал.
  //    Границы здесь «сырые» (MAX(bucket) — произвольная минута); до целых
  //    периодов их доводит rollupRange, см. ALIGNED_RANGE. Выравнивать их в JS
  //    нельзя: единица периода режется на стороне БД.
  const tailLo = new Date(Math.max(srcLo.getTime(), srcHi.getTime() - tail * step));
  let written = await rollupRange(
    pool, srcPrices, dstPrices, srcSnaps, dstSnaps, unit,
    tailLo, new Date(srcHi.getTime() + step),
  );

  // 2. Порция истории — назад от самого раннего свёрнутого периода.
  const dstLo = rows[0]?.dst_lo ? new Date(rows[0].dst_lo) : tailLo;
  if (dstLo.getTime() > srcLo.getTime()) {
    const histLo = new Date(Math.max(srcLo.getTime(), dstLo.getTime() - chunk * step));
    written += await rollupRange(
      pool, srcPrices, dstPrices, srcSnaps, dstSnaps, unit, histLo, dstLo,
    );
  }

  return written;
}

/**
 * Свёртка футпринта: часовой уровень из пятиминутного. Отдельная функция, а не
 * rollupLevel: у футпринта другие колонки (buyVol/sellVol) и нет парной таблицы
 * счётчиков — нормировать кластеры не нужно, они складываются как есть.
 *
 * Границы тут были выровнены изначально (date_trunc от обеих), поэтому обрезков
 * как в rollupLevel не возникало; зона прибита к UTC по той же причине, что и
 * там — см. truncUtc.
 */
export async function rollupFootprintLevel(pool, limit) {
  const { rows: state } = await pool.query(
    `SELECT (SELECT MAX("bucket") FROM "ObFootprintRollupH") AS done,
            (SELECT MIN("bucket") FROM "ObFootprintRollup") AS first`,
  );
  const from = state[0]?.done ?? state[0]?.first;
  if (!from) return 0;

  const hourUtc = (expr) => truncUtc(expr, `'hour'`);
  const { rowCount } = await pool.query(
    `WITH b AS (
       SELECT ${hourUtc("$1::timestamptz")} AS lo,
              LEAST(${hourUtc("now()")} + interval '1 hour',
                    ${hourUtc("$1::timestamptz")} + ($2 || ' hour')::interval) AS hi
     )
     INSERT INTO "ObFootprintRollupH" ("symbol","exchange","bucket","price","buyVol","sellVol")
     SELECT s."symbol", s."exchange", ${hourUtc('s."bucket"')} AS bkt, s."price",
            SUM(s."buyVol"), SUM(s."sellVol")
     FROM "ObFootprintRollup" s, b
     WHERE s."bucket" >= b.lo AND s."bucket" < b.hi
     GROUP BY s."symbol", s."exchange", bkt, s."price"
     ON CONFLICT ("symbol","exchange","bucket","price")
     DO UPDATE SET "buyVol" = EXCLUDED."buyVol", "sellVol" = EXCLUDED."sellVol"`,
    [from, String(limit)],
  );
  return rowCount ?? 0;
}

/**
 * Полный проход каскада: час из минут, сутки из часов, часовой футпринт.
 *
 * Дневной уровень строим из ЧАСОВОГО, а не из минутного: он уже в сотни раз
 * меньше, а суммы совпадают — сложение ассоциативно.
 */
export async function rollupCascade(pool, opts = {}) {
  const log = opts.log ?? console;
  try {
    const h = await rollupLevel(
      pool, "ObSnapshotRollup", "ObSnapshotRollupH",
      "ObRollupBucket", "ObRollupBucketH",
      "hour", CASCADE_CHUNK_HOURS, CASCADE_TAIL_HOURS,
    );
    const d = await rollupLevel(
      pool, "ObSnapshotRollupH", "ObSnapshotRollupD",
      "ObRollupBucketH", "ObRollupBucketD",
      "day", CASCADE_CHUNK_DAYS, CASCADE_TAIL_DAYS,
    );
    const fp = await rollupFootprintLevel(pool, CASCADE_CHUNK_HOURS);
    if (h || d || fp) log.log(`[cascade] свёрнуто строк: час=${h} сутки=${d} футпринт=${fp}`);
    return { hour: h, day: d, footprint: fp };
  } catch (err) {
    log.error(`[cascade] ошибка: ${err.message}`);
    return { hour: 0, day: 0, footprint: 0, error: err.message };
  }
}
