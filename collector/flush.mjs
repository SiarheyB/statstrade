// Запись накопленных rollup-бакетов: повтор при сбое, атомарность, чанкование.
//
// Отдельный модуль, а не тело index.mjs, чтобы это покрывалось тестами: импорт
// index.mjs поднимает пул соединений и HTTP-сервер. Тот же приём, что с
// prune.mjs и cascade.mjs.

/** Сколько раз пробуем записать бакет, прежде чем сдаться. */
export const FLUSH_MAX_ATTEMPTS = 5;

/**
 * Сбросить один накопленный бакет и убрать его из памяти — ТОЛЬКО после
 * успешной записи.
 *
 * Раньше `map.delete(key)` стоял ПЕРЕД записью, и любая транзиентная ошибка
 * (рестарт БД по watchtower, deadlock, lock_timeout во время pruneOld, OOM
 * backend-процесса) молча съедала целую минуту стакана, ленты и футпринта по
 * всем фидам. Восстановить было нечем: rollup — единственный носитель истории
 * лимиток, сырой ObSnapshot живёт неделю и к этому моменту уже прочитан.
 *
 * Настолько «нечем», что под этот баг подстраивалась архитектура: миграция
 * orderflow_index_diet отдельно объясняет, почему BRIN создаёт коллектор через
 * CONCURRENTLY, — обычный CREATE INDEX заблокировал бы вставки, и накопленные
 * бакеты потерялись бы.
 *
 * Повторная запись безопасна только потому, что write атомарен: upsert
 * складывает (`+= EXCLUDED`), и частично записанный бакет при повторе
 * задвоился бы. См. withTx.
 *
 * Предел попыток нужен, чтобы «вечно неудачный» бакет (битые данные, а не
 * временный сбой) не оставался в памяти навсегда.
 */
export async function flushOne(map, key, entry, label, write, opts = {}) {
  const log = opts.log ?? console;
  const maxAttempts = opts.maxAttempts ?? FLUSH_MAX_ATTEMPTS;
  try {
    await write();
    map.delete(key);
    return "written";
  } catch (err) {
    entry.attempts = (entry.attempts ?? 0) + 1;
    if (entry.attempts >= maxAttempts) {
      map.delete(key);
      log.error(`[rollup] ${label} ${key}: сдались после ${entry.attempts} попыток — ${err.message}`);
      return "dropped";
    }
    log.error(`[rollup] ${label} ${key}: попытка ${entry.attempts}, повторим — ${err.message}`);
    return "retry";
  }
}

/** Всё внутри одной транзакции: частично записанный бакет хуже незаписанного. */
export async function withTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Потолок параметров в протоколе Postgres — 65535 на запрос.
 *
 * Один бакет может дать сколько угодно ценовых уровней: тумблер «Отбирать всё»
 * в админке (CollectorConfig.collectAll) снимает порог minCoins. Без порций его
 * включение роняло бы запись стакана целиком с «bind message supplies N
 * parameters, but prepared statement requires ...» — и молча, до тех пор пока
 * тумблер не выключат обратно.
 */
export const MAX_BIND_PARAMS = 60_000;

/** Многострочный INSERT порциями. rows — массив массивов значений. */
export async function insertChunked(client, table, cols, rows, conflict = "") {
  if (rows.length === 0) return 0;
  const perRow = cols.length;
  const chunkSize = Math.max(1, Math.floor(MAX_BIND_PARAMS / perRow));
  const colList = cols.map((c) => `"${c}"`).join(",");
  let chunks = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const values = slice
      .map((_, j) => `(${cols.map((__, k) => `$${j * perRow + k + 1}`).join(",")})`)
      .join(",");
    await client.query(
      `INSERT INTO "${table}" (${colList}) VALUES ${values} ${conflict}`.trim(),
      slice.flat(),
    );
    chunks++;
  }
  return chunks;
}
