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
});
