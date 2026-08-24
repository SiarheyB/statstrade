import { describe, it, expect, vi } from "vitest";
import {
  overduePartitions,
  dropOldPartitions,
  orphanPartitions,
  dropOrphanPartitions,
  pruneDefaultPartition,
  prunePartitionedTables,
} from "../prune.mjs";

/** Пул-заглушка: сам решает, что ответить, и запоминает запросы. */
function makePool(handler) {
  const calls = [];
  const clientCalls = [];
  const released = { count: 0 };
  const run = (sql, params, sink) => {
    sink.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    return handler(sql, params);
  };
  return {
    calls,
    clientCalls,
    released,
    query: (sql, params) => run(sql, params, calls),
    connect: async () => ({
      query: (sql, params) => run(sql, params, clientCalls),
      release: () => { released.count++; },
    }),
  };
}

const parts = (...names) => ({ rows: names.map((name) => ({ name, upper: "2026-07-08T00:00:00Z" })) });
const silent = { log: { error: () => {}, warn: () => {} } };

describe("collector/prune", () => {
  it("overduePartitions спрашивает партиции таблицы с нужным ретеншном", async () => {
    const pool = makePool(() => parts("ObTrade_p20260707"));
    const rows = await overduePartitions(pool, "ObTrade", 30);
    expect(rows).toHaveLength(1);
    expect(pool.calls[0].params).toEqual(["ObTrade", "30"]);
    expect(pool.calls[0].sql).toContain("pg_inherits");
    expect(pool.calls[0].sql).toContain("<> 'DEFAULT'"); // DEFAULT не трогаем
  });

  it("дропает каждую партицию отдельным запросом и под lock_timeout", async () => {
    const pool = makePool((sql) => (sql.includes("pg_inherits") ? parts("A", "B") : { rows: [] }));
    const r = await dropOldPartitions(pool, "ObTrade", 30, silent);

    expect(r.dropped).toEqual(["A", "B"]);
    expect(pool.clientCalls[0].sql).toBe("SET lock_timeout = 5000");
    expect(pool.clientCalls.map((c) => c.sql)).toContain('DROP TABLE IF EXISTS "A"');
    expect(pool.clientCalls.map((c) => c.sql)).toContain('DROP TABLE IF EXISTS "B"');
    expect(pool.clientCalls.at(-1).sql).toBe("RESET lock_timeout");
    expect(pool.released.count).toBe(1);
  });

  it("занятая партиция не мешает удалить остальные", async () => {
    // Ровно та поломка, из-за которой июльские партиции жили до конца августа:
    // раньше все дропы шли одной транзакцией и падали целиком.
    const pool = makePool((sql) => {
      if (sql.includes("pg_inherits")) return parts("A", "LOCKED", "C");
      if (sql.includes('DROP TABLE IF EXISTS "LOCKED"')) throw new Error("canceling statement due to lock timeout");
      return { rows: [] };
    });
    const r = await dropOldPartitions(pool, "ObFootprint", 30, silent);
    expect(r.dropped).toEqual(["A", "C"]);
    expect(r.failed).toEqual([{ name: "LOCKED", error: "canceling statement due to lock timeout" }]);
  });

  it("соединение возвращается в пул даже при ошибке", async () => {
    const pool = makePool((sql) => {
      if (sql.includes("pg_inherits")) return parts("A");
      if (sql.startsWith("SET lock_timeout")) throw new Error("boom");
      return { rows: [] };
    });
    await expect(dropOldPartitions(pool, "ObTrade", 30, silent)).rejects.toThrow("boom");
    expect(pool.released.count).toBe(1);
  });

  it("ничего не делает, когда просроченных партиций нет", async () => {
    const pool = makePool(() => ({ rows: [] }));
    const r = await dropOldPartitions(pool, "ObTrade", 30, silent);
    expect(r.dropped).toEqual([]);
    expect(pool.clientCalls).toEqual([]); // соединение даже не берём
  });

  it("чистит строки, застрявшие в DEFAULT-партиции", async () => {
    const warn = vi.fn();
    const pool = makePool((sql) => {
      if (sql.includes("to_regclass")) return { rows: [{ exists: true }] };
      return { rowCount: 12 };
    });
    const n = await pruneDefaultPartition(pool, "ObTrade", 30, { log: { warn, error: () => {} } });
    expect(n).toBe(12);
    expect(pool.calls[1].sql).toContain('DELETE FROM "ObTrade_default" WHERE "t" <');
    expect(warn).toHaveBeenCalled();
  });

  it("нет DEFAULT-партиции — нет и запроса на удаление", async () => {
    const pool = makePool(() => ({ rows: [{ exists: false }] }));
    expect(await pruneDefaultPartition(pool, "ObTrade", 30, silent)).toBe(0);
    expect(pool.calls).toHaveLength(1);
  });

  it("сбой одной таблицы не отменяет очистку остальных", async () => {
    const pool = makePool((sql, params) => {
      if (sql.includes("NOT EXISTS")) return { rows: [] }; // сирот нет
      if (sql.includes("pg_inherits")) {
        if (params[0] === "ObSnapshot") throw new Error("relation does not exist");
        return parts(`${params[0]}_p20260707`);
      }
      if (sql.includes("to_regclass")) return { rows: [{ exists: false }] };
      return { rows: [] };
    });
    const status = await prunePartitionedTables(
      pool,
      [
        { table: "ObSnapshot", days: 3 },
        { table: "ObTrade", days: 30 },
        { table: "ObFootprint", days: 30 },
      ],
      silent,
    );
    expect(status.tables.ObSnapshot.error).toContain("relation does not exist");
    expect(status.tables.ObTrade.dropped).toBe(1);
    expect(status.tables.ObFootprint.dropped).toBe(1);
    expect(status.dropped).toBe(2);
    expect(status.errors).toHaveLength(1);
  });

  it("orphanPartitions ищет неприкреплённые таблицы с именем партиции", async () => {
    const pool = makePool(() => ({ rows: [{ name: "ObTrade_p20260707", bytes: "31457280" }] }));
    const rows = await orphanPartitions(pool, "ObTrade", 30);
    expect(rows).toHaveLength(1);
    expect(pool.calls[0].params).toEqual(["ObTrade", "30"]);
    // строгий отбор: имя партиции, отсутствие родителя и дата старше границы
    expect(pool.calls[0].sql).toContain("_p[0-9]{8}$");
    expect(pool.calls[0].sql).toContain("NOT EXISTS");
    expect(pool.calls[0].sql).toContain("to_date");
  });

  it("осиротевшие партиции удаляются и считаются отдельно", async () => {
    const pool = makePool((sql) =>
      sql.includes("NOT EXISTS")
        ? { rows: [{ name: "ObTrade_p20260707", bytes: "10" }, { name: "ObTrade_p20260708", bytes: "20" }] }
        : { rows: [] },
    );
    const r = await dropOrphanPartitions(pool, "ObTrade", 30, silent);
    expect(r.dropped).toEqual(["ObTrade_p20260707", "ObTrade_p20260708"]);
    expect(r.bytes).toBe(30);
    expect(pool.clientCalls[0].sql).toBe("SET lock_timeout = 5000");
    expect(pool.released.count).toBe(1);
  });

  it("сироты попадают в общий счётчик и в статус таблицы", async () => {
    const pool = makePool((sql) => {
      if (sql.includes("NOT EXISTS")) return { rows: [{ name: "ObFootprint_p20260707", bytes: "1" }] };
      if (sql.includes("to_regclass")) return { rows: [{ exists: false }] };
      if (sql.includes("pg_inherits")) return parts("ObFootprint_p20260725");
      return { rows: [] };
    });
    const status = await prunePartitionedTables(pool, [{ table: "ObFootprint", days: 30 }], silent);
    expect(status.tables.ObFootprint.dropped).toBe(1);        // обычная партиция
    expect(status.tables.ObFootprint.orphansDropped).toBe(1); // осиротевшая
    expect(status.dropped).toBe(2);                            // и та и другая
  });

  it("статус помнит ретеншн каждой таблицы", async () => {
    const pool = makePool((sql) => (sql.includes("to_regclass") ? { rows: [{ exists: false }] } : { rows: [] }));
    const status = await prunePartitionedTables(
      pool,
      [{ table: "ObSnapshot", days: 3 }, { table: "ObTrade", days: 30 }],
      silent,
    );
    expect(status.tables.ObSnapshot.days).toBe(3);
    expect(status.tables.ObTrade.days).toBe(30);
    expect(status.errors).toEqual([]);
  });
});
