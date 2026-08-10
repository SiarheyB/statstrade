import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Cache } from "@/lib/cache";

describe("Cache (SimpleCache)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and returns a value before expiry", () => {
    Cache.set("k", "v", 1000);
    expect(Cache.get("k")).toBe("v");
  });

  it("returns undefined for a missing key", () => {
    expect(Cache.get("missing")).toBeUndefined();
  });

  it("expires after the ttl elapses", () => {
    Cache.set("k", 42, 1000);
    vi.advanceTimersByTime(1001);
    expect(Cache.get("k")).toBeUndefined();
  });

  it("is usable through the generic get", () => {
    Cache.set<number>("n", 7, 5000);
    const v = Cache.get<number>("n");
    expect(v).toBe(7);
  });

  // Раньше кэш не имел ни предела размера, ни вытеснения: протухшая запись
  // исчезала только если её кто-то перечитывал (SECURITY_AUDIT.md).
  it("не растёт без предела и выносит протухшее", () => {
    const before = Cache.size();
    for (let i = 0; i < 3000; i++) Cache.set(`flood:${i}`, i, 1000);
    expect(Cache.size()).toBeLessThanOrEqual(1000);
    expect(Cache.size()).toBeGreaterThan(before);
  });

  it("свежая перезапись не даёт вытеснить горячий ключ", () => {
    Cache.set("hot", "v", 60_000);
    for (let i = 0; i < 999; i++) Cache.set(`cold:${i}`, i, 60_000);
    // Обновляем горячий — он должен уйти в конец очереди вытеснения.
    Cache.set("hot", "v2", 60_000);
    for (let i = 0; i < 500; i++) Cache.set(`cold2:${i}`, i, 60_000);
    expect(Cache.get("hot")).toBe("v2");
  });
});
