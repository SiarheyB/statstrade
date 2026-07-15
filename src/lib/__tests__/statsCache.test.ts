import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  statsVersion,
  bumpStatsVersion,
  getCached,
  setCached,
} from "@/lib/statsCache";

describe("statsCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns version 0 for an unknown user and bumps it", () => {
    const before = statsVersion("u1");
    bumpStatsVersion("u1");
    expect(statsVersion("u1")).toBe(before + 1);
  });

  it("stores and retrieves a value within the TTL", () => {
    setCached("k", { trades: [1, 2] });
    expect(getCached("k")).toEqual({ trades: [1, 2] });
  });

  it("returns undefined for an unknown key", () => {
    expect(getCached("nope")).toBeUndefined();
  });

  it("expires entries after the TTL", () => {
    setCached("k", { trades: [] });
    expect(getCached("k")).toBeDefined();
    vi.advanceTimersByTime(61_000);
    expect(getCached("k")).toBeUndefined();
  });

  it("does not cache payloads exceeding the per-user trade cap", () => {
    const huge = { trades: Array.from({ length: 9000 }, (_, i) => i) };
    setCached("big", huge);
    expect(getCached("big")).toBeUndefined();
  });
});
