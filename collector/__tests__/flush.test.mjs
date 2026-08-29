import { describe, it, expect, vi } from "vitest";
import { flushOne, withTx, insertChunked, MAX_BIND_PARAMS, FLUSH_MAX_ATTEMPTS } from "../flush.mjs";

const silent = { error: () => {}, warn: () => {}, log: () => {} };

describe("collector/flush — flushOne", () => {
  it("убирает бакет из памяти только ПОСЛЕ успешной записи", async () => {
    const map = new Map([["k", { v: 1 }]]);
    const order = [];
    const write = async () => {
      // На момент записи бакет обязан быть ещё на месте: раньше delete стоял
      // перед write, и любая ошибка съедала целую минуту данных безвозвратно.
      order.push(map.has("k"));
    };
    const res = await flushOne(map, "k", map.get("k"), "flush", write, { log: silent });
    expect(order).toEqual([true]);
    expect(res).toBe("written");
    expect(map.has("k")).toBe(false);
  });

  it("при сбое ОСТАВЛЯЕТ бакет и считает попытку", async () => {
    const entry = { v: 1 };
    const map = new Map([["k", entry]]);
    const res = await flushOne(map, "k", entry, "flush", async () => { throw new Error("БД недоступна"); }, { log: silent });
    expect(res).toBe("retry");
    expect(map.has("k")).toBe(true);
    expect(entry.attempts).toBe(1);
  });

  it("следующий проход дописывает тот же бакет — данные не потеряны", async () => {
    const entry = { v: 1 };
    const map = new Map([["k", entry]]);
    let fail = true;
    const write = async () => { if (fail) throw new Error("deadlock"); };
    await flushOne(map, "k", entry, "flush", write, { log: silent });
    expect(map.has("k")).toBe(true);
    fail = false;
    await flushOne(map, "k", entry, "flush", write, { log: silent });
    expect(map.has("k")).toBe(false);
  });

  it("сдаётся после предела попыток, чтобы битый бакет не жил в памяти вечно", async () => {
    const entry = { v: 1 };
    const map = new Map([["k", entry]]);
    const write = async () => { throw new Error("битые данные"); };
    for (let i = 1; i < FLUSH_MAX_ATTEMPTS; i++) {
      expect(await flushOne(map, "k", entry, "flush", write, { log: silent })).toBe("retry");
      expect(map.has("k")).toBe(true);
    }
    expect(await flushOne(map, "k", entry, "flush", write, { log: silent })).toBe("dropped");
    expect(map.has("k")).toBe(false);
  });
});

/** Клиент-заглушка: пишет в журнал команды и умеет падать на нужной. */
function makePool(failOn = null) {
  const queries = [];
  const released = { count: 0 };
  const client = {
    query: async (sql, params) => {
      queries.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      if (failOn && sql.includes(failOn)) throw new Error(`сбой на ${failOn}`);
      return { rowCount: 0 };
    },
    release: () => { released.count++; },
  };
  return { queries, released, connect: async () => client };
}

describe("collector/flush — withTx", () => {
  it("оборачивает работу в BEGIN/COMMIT и возвращает соединение", async () => {
    const pool = makePool();
    await withTx(pool, (c) => c.query("INSERT INTO t VALUES (1)"));
    expect(pool.queries.map((q) => q.sql)).toEqual([
      "BEGIN", "INSERT INTO t VALUES (1)", "COMMIT",
    ]);
    expect(pool.released.count).toBe(1);
  });

  it("на ошибке откатывает и пробрасывает её наверх", async () => {
    const pool = makePool("INSERT");
    await expect(withTx(pool, (c) => c.query("INSERT INTO t VALUES (1)"))).rejects.toThrow("сбой");
    expect(pool.queries.map((q) => q.sql)).toContain("ROLLBACK");
    expect(pool.queries.map((q) => q.sql)).not.toContain("COMMIT");
    expect(pool.released.count).toBe(1);
  });

  it("частичная запись не остаётся в базе: обе вставки в одной транзакции", async () => {
    // Счётчик снапшотов и цены писались двумя отдельными запросами. Если
    // падала вторая, счётчик уже был учтён — колонка карты пустая при
    // ненулевом snaps, а повторная попытка (upsert складывает) его удваивала.
    const pool = makePool("ObSnapshotRollup");
    await expect(
      withTx(pool, async (c) => {
        await c.query('INSERT INTO "ObRollupBucket" ...');
        await c.query('INSERT INTO "ObSnapshotRollup" ...');
      }),
    ).rejects.toThrow();
    const sqls = pool.queries.map((q) => q.sql);
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls[sqls.length - 1]).toBe("ROLLBACK");
    expect(sqls).not.toContain("COMMIT");
  });
});

describe("collector/flush — insertChunked", () => {
  const cols = ["symbol", "exchange", "bucket", "price", "volSum", "bidSum", "askSum"];
  const rows = (n) => Array.from({ length: n }, (_, i) => ["BTCUSDT", "binance-futures", new Date(0), i, 1, 1, 0]);

  it("маленькую пачку пишет одним запросом", async () => {
    const c = { query: vi.fn().mockResolvedValue({}) };
    expect(await insertChunked(c, "T", cols, rows(3), "ON CONFLICT DO NOTHING")).toBe(1);
    expect(c.query).toHaveBeenCalledTimes(1);
    expect(c.query.mock.calls[0][1]).toHaveLength(3 * cols.length);
  });

  it("режет на порции, не превышая предел параметров Postgres", async () => {
    // 65535 — потолок протокола; при 7 колонках это ~9362 строки. Один бакет
    // столько даёт, если в админке включён тумблер «Отбирать всё».
    const c = { query: vi.fn().mockResolvedValue({}) };
    const n = 20_000;
    const chunks = await insertChunked(c, "T", cols, rows(n));
    expect(chunks).toBeGreaterThan(1);
    for (const call of c.query.mock.calls) {
      expect(call[1].length).toBeLessThanOrEqual(MAX_BIND_PARAMS);
    }
    const written = c.query.mock.calls.reduce((s, call) => s + call[1].length / cols.length, 0);
    expect(written).toBe(n);
  });

  it("нумерация плейсхолдеров начинается с $1 в КАЖДОЙ порции", async () => {
    const c = { query: vi.fn().mockResolvedValue({}) };
    await insertChunked(c, "T", cols, rows(20_000));
    for (const call of c.query.mock.calls) {
      expect(call[0]).toContain("($1,$2,$3,$4,$5,$6,$7)");
      // и не выходит за длину своей порции
      const maxPlaceholder = Math.max(...[...call[0].matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
      expect(maxPlaceholder).toBe(call[1].length);
    }
  });

  it("пустая пачка в базу не идёт", async () => {
    const c = { query: vi.fn() };
    expect(await insertChunked(c, "T", cols, [])).toBe(0);
    expect(c.query).not.toHaveBeenCalled();
  });
});
