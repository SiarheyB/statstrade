import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENV_KEYS = ["YANDEX_DISK_CLIENT_ID", "YANDEX_DISK_CLIENT_SECRET", "YANDEX_DISK_REDIRECT_URI"];

function setEnv() {
  process.env.YANDEX_DISK_CLIENT_ID = "yid";
  process.env.YANDEX_DISK_CLIENT_SECRET = "ysecret";
  process.env.YANDEX_DISK_REDIRECT_URI = "https://app.example.com/api/integrations/yandex/callback";
}
function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("yandexDisk integration", () => {
  beforeEach(() => {
    vi.resetModules();
    clearEnv();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnv();
  });

  it("isYandexDiskConfigured false without env, true with env", async () => {
    let mod = await import("@/lib/integrations/yandexDisk");
    expect(mod.isYandexDiskConfigured()).toBe(false);
    setEnv();
    vi.resetModules();
    mod = await import("@/lib/integrations/yandexDisk");
    expect(mod.isYandexDiskConfigured()).toBe(true);
  });

  it("getAuthUrl throws without env, builds url with env", async () => {
    const mod = await import("@/lib/integrations/yandexDisk");
    expect(() => mod.getAuthUrl("s1")).toThrow(mod.YandexDiskError);
    setEnv();
    const url = mod.getAuthUrl("s1");
    expect(url).toContain("https://oauth.yandex.ru/authorize?");
    expect(url).toContain("client_id=yid");
    expect(url).toContain("force_confirm=yes");
    expect(url).toContain("state=s1");
  });

  it("getPublicOrigin derives origin from redirect uri", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/yandexDisk");
    expect(mod.getPublicOrigin()).toBe("https://app.example.com");
  });

  it("exchangeCodeForTokens resolves and rejects appropriately", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/yandexDisk");
    (fetch as any).mockResolvedValueOnce(
      jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "OAuth" }),
    );
    const tok = await mod.exchangeCodeForTokens("code1");
    expect(tok.access_token).toBe("at");

    (fetch as any).mockResolvedValueOnce(jsonResponse({}, false, 400));
    await expect(mod.exchangeCodeForTokens("bad")).rejects.toThrow(mod.YandexDiskError);
  });

  it("refreshAccessToken resolves and rejects appropriately", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/yandexDisk");
    (fetch as any).mockResolvedValueOnce(
      jsonResponse({ access_token: "at2", refresh_token: "rt2", expires_in: 1800, token_type: "OAuth" }),
    );
    const tok = await mod.refreshAccessToken("rt1");
    expect(tok.access_token).toBe("at2");

    (fetch as any).mockResolvedValueOnce(jsonResponse({}, false, 401));
    await expect(mod.refreshAccessToken("rt1")).rejects.toThrow(mod.YandexDiskError);
  });

  it("revokeToken never throws", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/yandexDisk");
    (fetch as any).mockRejectedValue(new Error("down"));
    await expect(mod.revokeToken("tok")).resolves.toBeUndefined();
  });

  it("getUserLogin prefers display_name over login, returns null on failure/missing", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/yandexDisk");
    (fetch as any).mockResolvedValueOnce(jsonResponse({ user: { display_name: "Bob", login: "bob1" } }));
    expect(await mod.getUserLogin("at")).toBe("Bob");

    (fetch as any).mockResolvedValueOnce(jsonResponse({ user: { login: "bob1" } }));
    expect(await mod.getUserLogin("at")).toBe("bob1");

    (fetch as any).mockResolvedValueOnce(jsonResponse({}, false, 401));
    expect(await mod.getUserLogin("at")).toBeNull();

    (fetch as any).mockResolvedValueOnce(jsonResponse({}));
    expect(await mod.getUserLogin("at")).toBeNull();
  });

  it("uploadFile ensures nested folders then uploads via upload-url", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/yandexDisk");
    (fetch as any)
      .mockResolvedValueOnce(jsonResponse({})) // ensureFolder base
      .mockResolvedValueOnce(jsonResponse({})) // ensureFolder subdir1
      .mockResolvedValueOnce(jsonResponse({})) // ensureFolder subdir2
      .mockResolvedValueOnce(jsonResponse({ href: "https://upload.example/put" })) // get upload url
      .mockResolvedValueOnce(jsonResponse({})); // PUT bytes

    const res = await mod.uploadFile("at", "shot.png", "image/png", Buffer.from("abc"), ["2026-08", "breakout"]);
    expect(res).toEqual({ path: "app:/tradingstat_deal/2026-08/breakout/shot.png" });
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("uploadFile treats 409 (already exists) as non-error when ensuring folders", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/yandexDisk");
    (fetch as any)
      .mockResolvedValueOnce(jsonResponse({}, false, 409)) // base already exists
      .mockResolvedValueOnce(jsonResponse({ href: "https://upload.example/put" }))
      .mockResolvedValueOnce(jsonResponse({}));

    const res = await mod.uploadFile("at", "shot.png", "image/png", Buffer.from("abc"));
    expect(res.path).toBe("app:/tradingstat_deal/shot.png");
  });

  it("uploadFile throws when ensureFolder fails with non-409", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/yandexDisk");
    (fetch as any).mockResolvedValueOnce(jsonResponse({}, false, 500));
    await expect(mod.uploadFile("at", "x.png", "image/png", Buffer.from("a"))).rejects.toThrow(
      mod.YandexDiskError,
    );
  });

  it("uploadFile throws when getting upload url fails", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/yandexDisk");
    (fetch as any)
      .mockResolvedValueOnce(jsonResponse({})) // ensure folder ok
      .mockResolvedValueOnce(jsonResponse({}, false, 500)); // upload url fails
    await expect(mod.uploadFile("at", "x.png", "image/png", Buffer.from("a"))).rejects.toThrow(
      mod.YandexDiskError,
    );
  });

  it("uploadFile throws when PUT of bytes fails", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/yandexDisk");
    (fetch as any)
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ href: "https://upload.example/put" }))
      .mockResolvedValueOnce(jsonResponse({}, false, 500));
    await expect(mod.uploadFile("at", "x.png", "image/png", Buffer.from("a"))).rejects.toThrow(
      mod.YandexDiskError,
    );
  });

  it("publishResource resolves on success, throws on failure", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/yandexDisk");
    (fetch as any).mockResolvedValueOnce(jsonResponse({}));
    await expect(mod.publishResource("at", "app:/x")).resolves.toBeUndefined();

    (fetch as any).mockResolvedValueOnce(jsonResponse({}, false, 500));
    await expect(mod.publishResource("at", "app:/x")).rejects.toThrow(mod.YandexDiskError);
  });

  it("getPublicUrl returns url string or null", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/yandexDisk");
    (fetch as any).mockResolvedValueOnce(jsonResponse({ public_url: "https://disk.yandex.ru/i/abc" }));
    expect(await mod.getPublicUrl("at", "app:/x")).toBe("https://disk.yandex.ru/i/abc");

    (fetch as any).mockResolvedValueOnce(jsonResponse({}, false, 404));
    expect(await mod.getPublicUrl("at", "app:/x")).toBeNull();

    (fetch as any).mockResolvedValueOnce(jsonResponse({}));
    expect(await mod.getPublicUrl("at", "app:/x")).toBeNull();
  });

  it("unpublishResource and deleteResource never throw", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/yandexDisk");
    (fetch as any).mockRejectedValue(new Error("down"));
    await expect(mod.unpublishResource("at", "app:/x")).resolves.toBeUndefined();
    await expect(mod.deleteResource("at", "app:/x")).resolves.toBeUndefined();
  });

  it("getFreshDownloadHref returns href on success, throws on failure", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/yandexDisk");
    (fetch as any).mockResolvedValueOnce(jsonResponse({ href: "https://dl.example/file" }));
    expect(await mod.getFreshDownloadHref("at", "app:/x")).toBe("https://dl.example/file");

    (fetch as any).mockResolvedValueOnce(jsonResponse({}, false, 404));
    await expect(mod.getFreshDownloadHref("at", "app:/x")).rejects.toThrow(mod.YandexDiskError);
  });
});
