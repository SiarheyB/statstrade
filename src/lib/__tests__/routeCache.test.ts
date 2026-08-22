import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRouteCache } from "@/lib/routeCache";

describe("createRouteCache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("отдаёт значение до истечения TTL и забывает после", () => {
    const c = createRouteCache(1000);
    c.set("k", { a: 1 });
    expect(c.get("k")).toEqual({ a: 1 });
    vi.advanceTimersByTime(999);
    expect(c.get("k")).toEqual({ a: 1 });
    vi.advanceTimersByTime(2);
    expect(c.get("k")).toBeUndefined();
    // Протухшая запись не должна оставаться в памяти.
    expect(c.size()).toBe(0);
  });

  it("вытесняет самую старую запись при переполнении", () => {
    const c = createRouteCache(60_000, 3);
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    expect(c.size()).toBe(3);
    c.set("d", 4);
    expect(c.size()).toBe(3);
    expect(c.get("a")).toBeUndefined(); // самая старая ушла
    expect(c.get("d")).toBe(4);
  });

  it("обновление ключа не оставляет его на старой позиции", () => {
    const c = createRouteCache(60_000, 2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 11); // «горячий» ключ обновлён — он больше не самый старый
    c.set("c", 3);
    expect(c.get("a")).toBe(11);
    expect(c.get("b")).toBeUndefined();
  });

  it("fetch считает один раз и переиспользует результат", async () => {
    const c = createRouteCache(60_000);
    const compute = vi.fn().mockResolvedValue("v");
    expect(await c.fetch("k", compute)).toBe("v");
    expect(await c.fetch("k", compute)).toBe("v");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("fetch дедуплицирует параллельные вызовы одного ключа", async () => {
    const c = createRouteCache(60_000);
    let resolve!: (v: string) => void;
    const compute = vi.fn(() => new Promise<string>((r) => { resolve = r; }));

    const a = c.fetch("k", compute);
    const b = c.fetch("k", compute);
    expect(compute).toHaveBeenCalledTimes(1); // вторая тяжёлая агрегация не стартовала

    resolve("done");
    expect(await a).toBe("done");
    expect(await b).toBe("done");
  });

  it("после ошибки вычисления следующий вызов пробует снова", async () => {
    const c = createRouteCache(60_000);
    const compute = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");

    await expect(c.fetch("k", compute)).rejects.toThrow("boom");
    // Провал не должен кэшироваться и не должен залипать в inflight.
    expect(await c.fetch("k", compute)).toBe("ok");
    expect(compute).toHaveBeenCalledTimes(2);
  });

  describe("окно простоя (stale-while-revalidate)", () => {
    it("отдаёт протухшее сразу и обновляет в фоне", async () => {
      const compute = vi.fn().mockResolvedValue("свежее");
      const c = createRouteCache(1000, 200, { staleMs: 10_000 });
      c.set("k", "старое");

      vi.advanceTimersByTime(1500); // TTL вышел, окно простоя ещё нет
      // Ответ мгновенный — тем, что уже лежит.
      await expect(c.fetch("k", compute)).resolves.toBe("старое");
      // Но пересчёт запущен.
      expect(compute).toHaveBeenCalledTimes(1);

      // Когда фоновый пересчёт закончился, дальше отдаётся свежее.
      await vi.runAllTimersAsync();
      await expect(c.fetch("k", compute)).resolves.toBe("свежее");
      expect(compute).toHaveBeenCalledTimes(1);
    });

    it("за пределами окна ждёт пересчёт — отдавать нечего", async () => {
      const compute = vi.fn().mockResolvedValue("свежее");
      const c = createRouteCache(1000, 200, { staleMs: 5000 });
      c.set("k", "старое");

      vi.advanceTimersByTime(7000);
      await expect(c.fetch("k", compute)).resolves.toBe("свежее");
      expect(compute).toHaveBeenCalledTimes(1);
      // Совсем протухшая запись в памяти не остаётся.
      expect(c.get("k")).toBe("свежее");
    });

    it("без окна простоя ведёт себя как раньше", async () => {
      const compute = vi.fn().mockResolvedValue("свежее");
      const c = createRouteCache(1000);
      c.set("k", "старое");

      vi.advanceTimersByTime(1500);
      // Никакого «отдать старое»: ждём пересчёт.
      await expect(c.fetch("k", compute)).resolves.toBe("свежее");
    });

    it("параллельные запросы в окне простоя не ждут пересчёта", async () => {
      const compute = vi.fn().mockResolvedValue("свежее");
      const c = createRouteCache(1000, 200, { staleMs: 10_000 });
      c.set("k", "старое");
      vi.advanceTimersByTime(1500);

      const [a, b, d] = await Promise.all([
        c.fetch("k", compute),
        c.fetch("k", compute),
        c.fetch("k", compute),
      ]);

      expect([a, b, d]).toEqual(["старое", "старое", "старое"]);
      // И пересчёт при этом один на всех.
      expect(compute).toHaveBeenCalledTimes(1);
    });
  });
});
