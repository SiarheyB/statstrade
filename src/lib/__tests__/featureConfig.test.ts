import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
const upsert = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { featureConfig: { findMany: (...a: unknown[]) => findMany(...a), upsert: (...a: unknown[]) => upsert(...a) } },
}));

import {
  getFeatureConfig,
  getAllFeatureConfigs,
  setFeatureConfig,
  invalidateFeatureCache,
} from "@/lib/featureConfig";

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([]);
  upsert.mockReset().mockResolvedValue({});
  invalidateFeatureCache();
});

describe("featureConfig — кэш", () => {
  it("нет строки в БД — фича включена с дефолтами", async () => {
    const v = await getFeatureConfig("monteCarlo");
    expect(v.enabled).toBe(true);
  });

  it("строка из БД перекрывает дефолты", async () => {
    findMany.mockResolvedValue([
      { key: "monteCarlo", enabled: false, config: JSON.stringify({ simulations: 7 }) },
    ]);
    const v = await getFeatureConfig("monteCarlo");
    expect(v.enabled).toBe(false);
    expect((v as unknown as { simulations: number }).simulations).toBe(7);
  });

  it("битый JSON в config не роняет запрос", async () => {
    findMany.mockResolvedValue([{ key: "monteCarlo", enabled: true, config: "{не json" }]);
    await expect(getFeatureConfig("monteCarlo")).resolves.toMatchObject({ enabled: true });
  });

  // forexAccess() спрашивает по два флага, а /api/forex дёргает его на каждом
  // опросе — раз в 3 секунды на открытую вкладку.
  it("повторные чтения не ходят в БД", async () => {
    await getFeatureConfig("forex");
    await getFeatureConfig("forexPublicAccess");
    await getFeatureConfig("monteCarlo");
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  // getAllFeatureConfigs читает все ключи через Promise.all: без общего промиса
  // на холодном кэше каждый ушёл бы в БД сам.
  it("параллельные чтения на холодном кэше дают один запрос", async () => {
    let release!: (v: unknown[]) => void;
    findMany.mockReturnValue(new Promise((r) => { release = r as (v: unknown[]) => void; }));
    const all = Promise.all([
      getFeatureConfig("forex"),
      getFeatureConfig("playbooks"),
      getFeatureConfig("mentorMode"),
    ]);
    release([]);
    await all;
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("getAllFeatureConfigs — один запрос на все фичи", async () => {
    const all = await getAllFeatureConfigs();
    expect(all.length).toBeGreaterThan(5);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("правка из админки применяется сразу, а не через TTL", async () => {
    await getFeatureConfig("monteCarlo"); // прогрели кэш
    findMany.mockResolvedValue([{ key: "monteCarlo", enabled: false, config: null }]);

    // без сброса кэша значение осталось бы прежним
    await setFeatureConfig("monteCarlo", { enabled: false });
    const v = await getFeatureConfig("monteCarlo");
    expect(v.enabled).toBe(false);
  });
});
