import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_GIT_SHA = process.env.GIT_SHA;

describe("getDeployStatus", () => {
  beforeEach(() => {
    vi.resetModules(); // сбрасываем модульный кэш последнего коммита между тестами
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    if (ORIGINAL_GIT_SHA === undefined) delete process.env.GIT_SHA;
    else process.env.GIT_SHA = ORIGINAL_GIT_SHA;
    vi.unstubAllGlobals();
  });

  it("reports unavailable when GIT_SHA is not set (local dev)", async () => {
    delete process.env.GIT_SHA;
    const { getDeployStatus } = await import("../deployStatus");
    const status = await getDeployStatus();
    expect(status).toEqual({ available: false, reason: expect.stringContaining("GIT_SHA") });
  });

  it("reports up to date when running sha matches latest main sha", async () => {
    process.env.GIT_SHA = "abc123def456";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ sha: "abc123def456" }) }),
    );
    const { getDeployStatus } = await import("../deployStatus");
    const status = await getDeployStatus();
    expect(status).toMatchObject({ available: true, upToDate: true, runningSha: "abc123def456" });
  });

  it("reports pending when running sha differs from latest main sha", async () => {
    process.env.GIT_SHA = "old000000000";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ sha: "new111111111" }) }),
    );
    const { getDeployStatus } = await import("../deployStatus");
    const status = await getDeployStatus();
    expect(status).toMatchObject({
      available: true,
      upToDate: false,
      runningShaShort: "old0000",
      latestShaShort: "new1111",
    });
  });

  it("reports unavailable when GitHub API fails", async () => {
    process.env.GIT_SHA = "abc123";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { getDeployStatus } = await import("../deployStatus");
    const status = await getDeployStatus();
    expect(status).toEqual({ available: false, reason: expect.stringContaining("500") });
  });

  it("reports unavailable when fetch throws (network error)", async () => {
    process.env.GIT_SHA = "abc123";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { getDeployStatus } = await import("../deployStatus");
    const status = await getDeployStatus();
    expect(status).toEqual({ available: false, reason: "network down" });
  });

  it("отдаёт дату коммита — она и показывается в админке рядом с sha", async () => {
    process.env.GIT_SHA = "abc123def456";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            sha: "abc123def456",
            commit: { committer: { date: "2026-08-16T16:14:47Z" }, author: { date: "2026-08-15T10:00:00Z" } },
          }),
      }),
    );
    const { getDeployStatus } = await import("../deployStatus");
    const status = await getDeployStatus();
    // committer, а не author: при rebase/cherry-pick дата автора остаётся старой.
    expect(status).toMatchObject({ runningDate: "2026-08-16T16:14:47Z", latestDate: "2026-08-16T16:14:47Z" });
  });

  it("для отставшего деплоя запрашивает дату запущенного коммита отдельно", async () => {
    process.env.GIT_SHA = "old000000000";
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/main")
        ? { ok: true, json: async () => ({ sha: "new111111111", commit: { committer: { date: "2026-08-17T09:00:00Z" } } }) }
        : { ok: true, json: async () => ({ sha: "old000000000", commit: { committer: { date: "2026-08-10T12:30:00Z" } } }) },
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getDeployStatus } = await import("../deployStatus");
    const status = await getDeployStatus();
    expect(status).toMatchObject({
      upToDate: false,
      runningDate: "2026-08-10T12:30:00Z",
      latestDate: "2026-08-17T09:00:00Z",
    });
  });

  it("переживает коммит, которого нет на GitHub (локальная сборка)", async () => {
    process.env.GIT_SHA = "local0000000";
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/main")
        ? { ok: true, json: async () => ({ sha: "new111111111", commit: { committer: { date: "2026-08-17T09:00:00Z" } } }) }
        : { ok: false, status: 404, json: async () => ({}) },
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getDeployStatus } = await import("../deployStatus");
    const status = await getDeployStatus();
    expect(status).toMatchObject({ upToDate: false, runningDate: null });
  });
});
