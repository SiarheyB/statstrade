import { describe, it, expect } from "vitest";
import {
  ALIGNED_RANGE,
  truncUtc,
  unitMs,
  rollupRange,
  rollupLevel,
  rollupFootprintLevel,
} from "../cascade.mjs";

/** Пул-заглушка: отвечает по сценарию и запоминает запросы. */
function makePool(handler = () => ({ rows: [], rowCount: 0 })) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      return handler(sql, params) ?? { rows: [], rowCount: 0 };
    },
  };
}

const norm = (s) => s.replace(/\s+/g, " ").trim();

describe("collector/cascade — обрезка периодов", () => {
  it("unitMs различает час и сутки", () => {
    expect(unitMs("hour")).toBe(3_600_000);
    expect(unitMs("day")).toBe(86_400_000);
  });

  it("truncUtc режет в UTC, а не в таймзоне сессии", () => {
    // Голый date_trunc(unit, ts) зависит от TimeZone подключения: при сессии
    // в Europe/Moscow дневной бакет уехал бы на +3 часа, а в зоне с переходом
    // на летнее время сутки стали бы 23/25 часов — читающая сторона при этом
    // жёстко считает их равными 86 400 000 мс (LEVEL_MS в lib/orderflow.ts).
    const sql = truncUtc('s."bucket"');
    expect(sql).toContain("AT TIME ZONE 'UTC'");
    expect(norm(sql)).toBe(`(date_trunc($3, (s."bucket") AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`);
  });

  it("ALIGNED_RANGE опускает нижнюю границу и поднимает верхнюю", () => {
    // Диапазон обязан состоять из ЦЕЛЫХ периодов: свёртка пишет
    // ON CONFLICT DO UPDATE SET = EXCLUDED, и обрезок затирает полное значение.
    const sql = norm(ALIGNED_RANGE);
    expect(sql).toContain("AS lo");
    expect(sql).toContain("AS hi");
    // нижняя — просто обрезка вниз
    expect(sql).toContain(`(date_trunc($3, ($1::timestamptz) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS lo`);
    // верхняя — обрезка вверх: если уже на границе, оставляем как есть
    expect(sql).toContain("+ ('1 ' || $3)::interval");
  });
});

describe("collector/cascade — rollupRange", () => {
  it("группирует по тому же выражению, каким выровнены границы", async () => {
    const pool = makePool();
    await rollupRange(pool, "SrcP", "DstP", "SrcS", "DstS", "hour", new Date(1), new Date(2));

    expect(pool.calls).toHaveLength(2);
    for (const call of pool.calls) {
      // Границы берутся из CTE b, а не из «сырых» $1/$2 напрямую.
      expect(call.sql).toContain("WITH b AS");
      expect(call.sql).toContain('s."bucket" >= b.lo AND s."bucket" < b.hi');
      // Группировка — тем же UTC-выражением, что и границы.
      expect(call.sql).toContain(`date_trunc($3, (s."bucket") AT TIME ZONE 'UTC')`);
      // Ни одной голой обрезки без указания зоны не осталось.
      expect(call.sql).not.toMatch(/date_trunc\(\$3, s\."bucket"\)/);
      expect(call.params).toEqual([new Date(1), new Date(2), "hour"]);
    }
    // Первым идут цены, вторым — счётчики снапшотов (нормировка яркости).
    expect(pool.calls[0].sql).toContain('INSERT INTO "DstP"');
    expect(pool.calls[1].sql).toContain('INSERT INTO "DstS"');
  });

  it("перезаписывает суммы, а не прибавляет — свёртка идемпотентна", async () => {
    const pool = makePool();
    await rollupRange(pool, "SrcP", "DstP", "SrcS", "DstS", "day", new Date(1), new Date(2));
    expect(pool.calls[0].sql).toContain('DO UPDATE SET "volSum" = EXCLUDED."volSum"');
    expect(pool.calls[0].sql).not.toContain('"DstP"."volSum" +');
  });

  it("пустой или вывернутый диапазон не идёт в БД", async () => {
    const pool = makePool();
    expect(await rollupRange(pool, "a", "b", "c", "d", "hour", null, new Date(2))).toBe(0);
    expect(await rollupRange(pool, "a", "b", "c", "d", "hour", new Date(5), new Date(5))).toBe(0);
    expect(await rollupRange(pool, "a", "b", "c", "d", "hour", new Date(9), new Date(2))).toBe(0);
    expect(pool.calls).toHaveLength(0);
  });
});

describe("collector/cascade — rollupLevel", () => {
  const state = (srcLo, srcHi, dstLo) => ({
    rows: [{ src_lo: srcLo, src_hi: srcHi, dst_lo: dstLo }],
    rowCount: 1,
  });

  it("границы источника спрашивает у таблицы СЧЁТЧИКОВ, а не цен", async () => {
    // По таблице цен это Seq Scan на гигабайты: btree по bucket там снят
    // намеренно (миграция orderflow_index_diet), а BRIN на MIN/MAX не отвечает.
    // Диапазон бакетов у счётчиков тот же, а строк на два порядка меньше.
    const pool = makePool((sql) =>
      sql.includes("src_lo") ? state("2026-08-01T00:00:00Z", "2026-08-25T14:37:00Z", null) : undefined,
    );
    await rollupLevel(pool, "ObSnapshotRollup", "ObSnapshotRollupH", "ObRollupBucket", "ObRollupBucketH", "hour", 336, 6);

    const probe = pool.calls[0].sql;
    expect(probe).toContain('MIN("bucket") FROM "ObRollupBucket"');
    expect(probe).toContain('MAX("bucket") FROM "ObRollupBucket"');
    expect(probe).toContain('MIN("bucket") FROM "ObRollupBucketH"');
    expect(probe).not.toContain('"ObSnapshotRollup"');
  });

  it("хвост берёт последние tail периодов и захватывает текущий незавершённый", async () => {
    const srcHi = "2026-08-25T14:37:00Z";
    const pool = makePool((sql) =>
      sql.includes("src_lo") ? state("2026-08-01T00:00:00Z", srcHi, null) : undefined,
    );
    await rollupLevel(pool, "SrcP", "DstP", "SrcS", "DstS", "hour", 336, 6);

    // calls[0] — разведка; calls[1..2] — свёртка хвоста (цены + счётчики).
    const [lo, hi, unit] = pool.calls[1].params;
    expect(unit).toBe("hour");
    // Нижняя — ровно 6 часов назад от MAX(bucket) (выровняется уже в SQL).
    expect(lo.toISOString()).toBe("2026-08-25T08:37:00.000Z");
    // Верхняя — за концом данных, чтобы текущий период тоже попал.
    expect(hi.toISOString()).toBe("2026-08-25T15:37:00.000Z");
  });

  it("историю разбирает назад от самого раннего свёрнутого периода", async () => {
    const pool = makePool((sql) =>
      sql.includes("src_lo")
        ? state("2026-08-01T00:00:00Z", "2026-08-25T14:37:00Z", "2026-08-20T00:00:00Z")
        : undefined,
    );
    await rollupLevel(pool, "SrcP", "DstP", "SrcS", "DstS", "hour", 48, 6);

    // calls[3..4] — порция истории.
    const [lo, hi] = pool.calls[3].params;
    expect(hi.toISOString()).toBe("2026-08-20T00:00:00.000Z"); // до уже свёрнутого края
    expect(lo.toISOString()).toBe("2026-08-18T00:00:00.000Z"); // 48 часов назад
  });

  it("историю не трогает, когда каскад уже догнал источник", async () => {
    const pool = makePool((sql) =>
      sql.includes("src_lo")
        ? state("2026-08-01T00:00:00Z", "2026-08-25T14:37:00Z", "2026-08-01T00:00:00Z")
        : undefined,
    );
    await rollupLevel(pool, "SrcP", "DstP", "SrcS", "DstS", "hour", 48, 6);
    expect(pool.calls).toHaveLength(3); // разведка + только хвост
  });

  it("пустой источник — ни одного запроса на запись", async () => {
    const pool = makePool((sql) => (sql.includes("src_lo") ? state(null, null, null) : undefined));
    expect(await rollupLevel(pool, "SrcP", "DstP", "SrcS", "DstS", "hour", 48, 6)).toBe(0);
    expect(pool.calls).toHaveLength(1);
  });
});

describe("collector/cascade — rollupFootprintLevel", () => {
  it("обе границы выровнены по часу и прибиты к UTC", async () => {
    const pool = makePool((sql) =>
      sql.includes("done") ? { rows: [{ done: "2026-08-25T10:00:00Z", first: null }], rowCount: 1 } : undefined,
    );
    await rollupFootprintLevel(pool, 336);

    const sql = pool.calls[1].sql;
    expect(sql).toContain("AT TIME ZONE 'UTC'");
    expect(sql).not.toMatch(/date_trunc\('hour', s\."bucket"\)/);
    expect(sql).toContain('s."bucket" >= b.lo AND s."bucket" < b.hi');
  });

  it("нечего сворачивать — в БД не идём", async () => {
    const pool = makePool((sql) =>
      sql.includes("done") ? { rows: [{ done: null, first: null }], rowCount: 1 } : undefined,
    );
    expect(await rollupFootprintLevel(pool, 336)).toBe(0);
    expect(pool.calls).toHaveLength(1);
  });
});
