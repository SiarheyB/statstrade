// Очистка партиций ObSnapshot / ObTrade / ObFootprint / ObBigTrade.
//
// Раньше это делал один вызов ob_drop_partitions_before(tbl, cutoff): функция
// на plpgsql проходит по всем партициям таблицы и дропает их в ОДНОЙ
// транзакции. У такой схемы два отказа, и оба тихие:
//
//  1. любая ошибка на одной партиции откатывает всю транзакцию — ни одна
//     партиция не удаляется, и так каждый час до бесконечности;
//  2. DROP берёт ACCESS EXCLUSIVE и на партицию, и на родительскую таблицу,
//     а по ObFootprint/ObTrade приложение постоянно читает (карта ордеров
//     опрашивается раз в несколько секунд). Без lock_timeout запрос ждёт
//     блокировку сколько угодно — очистка просто зависает.
//
// Здесь партиции удаляются по одной, каждая своим запросом (то есть своей
// транзакцией) и с lock_timeout: занятая партиция пропускается до следующего
// часа, а остальные всё равно уходят. Плюс наружу отдаётся статус — что
// удалено, что не смогли и почему.

/** Сколько ждать блокировку на одну партицию. Дальше — пробуем в следующий раз. */
const LOCK_TIMEOUT_MS = 5000;

/**
 * Партиции таблицы, целиком лежащие раньше границы (DEFAULT не трогаем).
 * @returns {Promise<{name: string, upper: string}[]>}
 */
export async function overduePartitions(pool, table, cutoffDays) {
  const { rows } = await pool.query(
    `SELECT c.relname AS name,
            ((regexp_match(pg_get_expr(c.relpartbound, c.oid), 'TO \\(''([^'']+)''\\)'))[1])::timestamptz AS upper
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = quote_ident($1)::regclass
        AND pg_get_expr(c.relpartbound, c.oid) <> 'DEFAULT'
        AND ((regexp_match(pg_get_expr(c.relpartbound, c.oid), 'TO \\(''([^'']+)''\\)'))[1])::timestamptz
            <= NOW() - ($2 || ' days')::interval
      ORDER BY c.relname`,
    [table, String(cutoffDays)],
  );
  return rows;
}

/**
 * Удалить просроченные партиции одной таблицы.
 *
 * @returns {Promise<{table: string, dropped: string[], failed: {name: string, error: string}[]}>}
 */
export async function dropOldPartitions(pool, table, cutoffDays, opts = {}) {
  const lockTimeoutMs = opts.lockTimeoutMs ?? LOCK_TIMEOUT_MS;
  const log = opts.log ?? console;
  const result = { table, dropped: [], failed: [] };

  const parts = await overduePartitions(pool, table, cutoffDays);
  if (parts.length === 0) return result;

  const client = await pool.connect();
  try {
    await client.query(`SET lock_timeout = ${Number(lockTimeoutMs)}`);
    for (const p of parts) {
      try {
        // Каждый DROP — отдельный запрос: занятая партиция не уносит с собой
        // все остальные, как это было с общей транзакцией.
        await client.query(`DROP TABLE IF EXISTS "${p.name}"`);
        result.dropped.push(p.name);
      } catch (err) {
        result.failed.push({ name: p.name, error: err.message });
      }
    }
  } finally {
    try { await client.query("RESET lock_timeout"); } catch { /* соединение уже могло отвалиться */ }
    client.release();
  }

  if (result.failed.length > 0) {
    log.error?.(
      `[prune] ${table}: не удалось удалить ${result.failed.length} партиций ` +
      `(${result.failed.slice(0, 3).map((f) => `${f.name}: ${f.error}`).join("; ")})`,
    );
  }
  return result;
}

/**
 * «Осиротевшие» партиции: таблицы с именем партиции, которые ни к чему не
 * прикреплены.
 *
 * Такое бывает после ручного ALTER TABLE ... DETACH PARTITION, после
 * пересоздания родительской таблицы (партиции остаются обычными таблицами) и
 * после прерванной миграции. Беда в том, что они невидимы: обход по
 * pg_inherits их не находит, значит очистка их не трогает и отчитывается
 * «удалять нечего», а место они занимают наравне с живыми — на скриншотах
 * админки это выглядит как «июль не удаляется, а ошибок нет».
 *
 * Отбор строгий: только имя вида <Таблица>_pГГГГММДД, только не прикреплённые,
 * и только те, чья дата в имени старше границы ретеншна.
 */
export async function orphanPartitions(pool, table, cutoffDays) {
  const { rows } = await pool.query(
    `SELECT c.relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()
        AND c.relkind = 'r'
        AND c.relname ~ ('^' || $1 || '_p[0-9]{8}$')
        AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
        AND (to_date(right(c.relname, 8), 'YYYYMMDD') + 1)
            <= (NOW() - ($2 || ' days')::interval)::date
      ORDER BY c.relname`,
    [table, String(cutoffDays)],
  );
  return rows;
}

/** Удалить осиротевшие партиции (см. orphanPartitions). */
export async function dropOrphanPartitions(pool, table, cutoffDays, opts = {}) {
  const lockTimeoutMs = opts.lockTimeoutMs ?? LOCK_TIMEOUT_MS;
  const log = opts.log ?? console;
  const result = { dropped: [], failed: [], bytes: 0 };

  const parts = await orphanPartitions(pool, table, cutoffDays);
  if (parts.length === 0) return result;

  log.warn?.(
    `[prune] ${table}: найдено ${parts.length} осиротевших партиций ` +
    `(не прикреплены к таблице, поэтому обычная очистка их не видела) — удаляю`,
  );

  const client = await pool.connect();
  try {
    await client.query(`SET lock_timeout = ${Number(lockTimeoutMs)}`);
    for (const p of parts) {
      try {
        await client.query(`DROP TABLE IF EXISTS "${p.name}"`);
        result.dropped.push(p.name);
        result.bytes += Number(p.bytes ?? 0);
      } catch (err) {
        result.failed.push({ name: p.name, error: err.message });
      }
    }
  } finally {
    try { await client.query("RESET lock_timeout"); } catch { /* соединение уже могло отвалиться */ }
    client.release();
  }
  return result;
}

/**
 * Строки, застрявшие в DEFAULT-партиции.
 *
 * Туда попадает всё, для чего в момент записи не оказалось дневной партиции
 * (коллектор пережил полночь без ob_ensure_partitions, скачок часов, ручная
 * вставка). DROP их не достаёт — DEFAULT удалять нельзя, — поэтому чистим
 * обычным DELETE по той же границе ретеншна.
 */
export async function pruneDefaultPartition(pool, table, cutoffDays, opts = {}) {
  const log = opts.log ?? console;
  const defName = `${table}_default`;
  try {
    const { rows } = await pool.query(
      `SELECT to_regclass($1) IS NOT NULL AS exists`,
      [`"${defName}"`],
    );
    if (!rows[0]?.exists) return 0;
    const r = await pool.query(
      // Ключ партиционирования у всех четырёх таблиц — "t" (см. миграцию
      // partition_ob_tables), у rollup-таблиц он называется bucket, но их
      // здесь нет: они не партиционированы.
      `DELETE FROM "${defName}" WHERE "t" < NOW() - ($1 || ' days')::interval`,
      [String(cutoffDays)],
    );
    const n = r.rowCount ?? 0;
    if (n > 0) {
      log.warn?.(
        `[prune] ${defName}: удалено ${n} строк — данные пишутся мимо дневных партиций, ` +
        `проверьте ob_ensure_partitions`,
      );
    }
    return n;
  } catch (err) {
    log.error?.(`[prune] ${defName}: ${err.message}`);
    return 0;
  }
}

/**
 * Полный проход по партиционированным таблицам.
 *
 * Каждая таблица обрабатывается независимо: сбой на одной не мешает
 * остальным — раньше любая ошибка внутри pruneOld() обрывала всю очистку.
 *
 * @param {{table: string, days: number}[]} plan
 */
export async function prunePartitionedTables(pool, plan, opts = {}) {
  const log = opts.log ?? console;
  const status = { at: Date.now(), dropped: 0, tables: {}, errors: [] };

  for (const { table, days } of plan) {
    try {
      const r = await dropOldPartitions(pool, table, days, opts);
      // Отдельным проходом — партиции, отвалившиеся от родителя: обычный
      // обход по pg_inherits их не видит (см. orphanPartitions).
      const orphans = await dropOrphanPartitions(pool, table, days, opts);
      const defRows = await pruneDefaultPartition(pool, table, days, opts);
      status.dropped += r.dropped.length + orphans.dropped.length;
      status.tables[table] = {
        days,
        dropped: r.dropped.length,
        failed: r.failed.length,
        orphansDropped: orphans.dropped.length,
        orphansFailed: orphans.failed.length,
        defaultRowsDeleted: defRows,
      };
      if (r.failed.length > 0) {
        status.errors.push(`${table}: ${r.failed[0].name} — ${r.failed[0].error}`);
      }
      if (orphans.failed.length > 0) {
        status.errors.push(`${table}: ${orphans.failed[0].name} (сирота) — ${orphans.failed[0].error}`);
      }
    } catch (err) {
      status.tables[table] = { days, dropped: 0, failed: 0, orphansDropped: 0, orphansFailed: 0, defaultRowsDeleted: 0, error: err.message };
      status.errors.push(`${table}: ${err.message}`);
      log.error?.(`[prune] ${table}: ${err.message}`);
    }
  }
  return status;
}
