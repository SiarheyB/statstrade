import { describe, it, expect, vi, beforeEach } from "vitest";

// $queryRaw вызывается как тег шаблонной строки: собираем текст запроса и
// подставленные значения, чтобы проверять именно SQL. Через vi.hoisted —
// иначе фабрика мока не увидит переменные (она поднимается наверх файла).
const mocks = vi.hoisted(() => {
  const calls: { sql: string; values: unknown[] }[] = [];
  return {
    calls,
    queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?"), values });
      return Promise.resolve([{ n: 0 }]);
    }),
  };
});

vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: mocks.queryRaw } }));

import { getSessionStats } from "@/lib/traffic/query";

const RANGE = {
  from: new Date("2026-08-15T00:00:00Z"),
  to: new Date("2026-08-22T00:00:00Z"),
  audience: "all" as const,
  bucket: "day" as const,
  tzOffsetMin: 0,
};

describe("getSessionStats — новые посетители", () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.queryRaw.mockClear();
  });

  it("считает новых по просмотрам — тем же источником, что и карточка «Посетители»", async () => {
    await getSessionStats(RANGE);

    const newVisitors = mocks.calls[1];
    expect(newVisitors).toBeDefined();
    // Источник — PageView (как у totals), а не сессии.
    expect(newVisitors.sql).toContain('FROM "PageView"');
    expect(newVisitors.sql).not.toContain('FROM "VisitSession"');
  });

  it("сужает подсчёт до выбранной аудитории", async () => {
    await getSessionStats({ ...RANGE, audience: "human" });

    // Фильтр приходит подготовленным фрагментом Prisma.sql — смотрим на него,
    // а не на текст шаблона.
    const newVisitors = mocks.calls[1];
    expect(JSON.stringify(newVisitors.values)).toContain("isBot");

    // При «Все» фильтра нет вовсе: считаем и людей, и роботов.
    mocks.calls.length = 0;
    await getSessionStats({ ...RANGE, audience: "all" });
    const allAudience = mocks.calls[1];
    expect(JSON.stringify(allAudience.values)).not.toContain("isBot");
  });

  it("новым считает того, у кого раньше не было ни одного просмотра", async () => {
    await getSessionStats(RANGE);

    const newVisitors = mocks.calls[1];
    // Прошлое проверяется по всей истории до начала периода…
    expect(newVisitors.sql).toContain("NOT EXISTS");
    expect(newVisitors.sql).toMatch(/p\."ts" < /);
    // …а не через min() внутри уже отфильтрованного окна: такое условие
    // выполнялось всегда, и новыми оказывались вообще все посетители.
    expect(newVisitors.sql).not.toContain("HAVING");
    // Границей служит начало периода.
    expect(newVisitors.values).toContain(RANGE.from);
  });
});
