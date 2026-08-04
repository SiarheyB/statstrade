import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENV_KEYS = ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REDIRECT_URI"];

function setEnv() {
  process.env.GOOGLE_DRIVE_CLIENT_ID = "client-id";
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_DRIVE_REDIRECT_URI = "https://app.example.com/api/integrations/google/callback";
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

describe("googleDrive integration", () => {
  beforeEach(() => {
    vi.resetModules();
    clearEnv();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnv();
  });

  it("isGoogleDriveConfigured is false without env vars", async () => {
    const mod = await import("@/lib/integrations/googleDrive");
    expect(mod.isGoogleDriveConfigured()).toBe(false);
  });

  it("isGoogleDriveConfigured is true with all env vars set", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    expect(mod.isGoogleDriveConfigured()).toBe(true);
  });

  it("getAuthUrl throws GoogleDriveError when env missing", async () => {
    const mod = await import("@/lib/integrations/googleDrive");
    expect(() => mod.getAuthUrl("state123")).toThrow(mod.GoogleDriveError);
  });

  it("getAuthUrl builds a proper query string when configured", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    const url = mod.getAuthUrl("state123");
    expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth?");
    expect(url).toContain("client_id=client-id");
    expect(url).toContain("state=state123");
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
  });

  it("getPublicOrigin derives origin from redirect URI", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    expect(mod.getPublicOrigin()).toBe("https://app.example.com");
  });

  it("exchangeCodeForTokens returns parsed tokens on success", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    (fetch as any).mockResolvedValue(
      jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "Bearer" }),
    );
    const tokens = await mod.exchangeCodeForTokens("authcode");
    expect(tokens.access_token).toBe("at");
    expect(fetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("exchangeCodeForTokens throws GoogleDriveError on non-ok response", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    (fetch as any).mockResolvedValue(jsonResponse({}, false, 400));
    await expect(mod.exchangeCodeForTokens("bad")).rejects.toThrow(mod.GoogleDriveError);
  });

  it("refreshAccessToken returns tokens on success and throws on failure", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    (fetch as any).mockResolvedValueOnce(
      jsonResponse({ access_token: "at2", expires_in: 3600, token_type: "Bearer" }),
    );
    const tok = await mod.refreshAccessToken("rt1");
    expect(tok.access_token).toBe("at2");

    (fetch as any).mockResolvedValueOnce(jsonResponse({}, false, 401));
    await expect(mod.refreshAccessToken("rt1")).rejects.toThrow(mod.GoogleDriveError);
  });

  it("revokeToken never throws even if fetch rejects", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    (fetch as any).mockRejectedValue(new Error("network down"));
    await expect(mod.revokeToken("tok")).resolves.toBeUndefined();
  });

  it("getUserEmail returns email on success, null on failure", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    (fetch as any).mockResolvedValueOnce(jsonResponse({ email: "a@b.com" }));
    expect(await mod.getUserEmail("at")).toBe("a@b.com");

    (fetch as any).mockResolvedValueOnce(jsonResponse({}, false, 401));
    expect(await mod.getUserEmail("at")).toBeNull();

    (fetch as any).mockResolvedValueOnce(jsonResponse({ notEmail: 1 }));
    expect(await mod.getUserEmail("at")).toBeNull();
  });

  it("getOrCreateAppFolder returns existing folder id when found", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    (fetch as any).mockResolvedValueOnce(jsonResponse({ files: [{ id: "folder1" }] }));
    const id = await mod.getOrCreateAppFolder("at", "MyFolder");
    expect(id).toBe("folder1");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("getOrCreateAppFolder creates a folder when not found", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    (fetch as any)
      .mockResolvedValueOnce(jsonResponse({ files: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: "newfolder" }));
    const id = await mod.getOrCreateAppFolder("at", "MyFolder", "parent1");
    expect(id).toBe("newfolder");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("getOrCreateAppFolder throws when search fails", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    (fetch as any).mockResolvedValueOnce(jsonResponse({}, false, 500));
    await expect(mod.getOrCreateAppFolder("at", "X")).rejects.toThrow(mod.GoogleDriveError);
  });

  it("getOrCreateAppFolder throws when create fails", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    (fetch as any)
      .mockResolvedValueOnce(jsonResponse({ files: [] }))
      .mockResolvedValueOnce(jsonResponse({}, false, 500));
    await expect(mod.getOrCreateAppFolder("at", "X")).rejects.toThrow(mod.GoogleDriveError);
  });

  it("getOrCreateNestedFolders chains folder creation for each segment", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    (fetch as any)
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: "f1" }] }))
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: "f2" }] }));
    const id = await mod.getOrCreateNestedFolders("at", "root", ["2026-08", "breakout"]);
    expect(id).toBe("f2");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uploadImage posts multipart body and returns file id", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    (fetch as any).mockResolvedValueOnce(jsonResponse({ id: "file1" }));
    const res = await mod.uploadImage("at", "shot.png", "image/png", Buffer.from("abc"), "folder1");
    expect(res).toEqual({ id: "file1" });
    const call = (fetch as any).mock.calls[0];
    expect(call[0]).toContain("uploadType=multipart");
    expect(call[1].headers["Content-Type"]).toMatch(/^multipart\/related; boundary=tsboundary_/);
  });

  it("uploadImage throws GoogleDriveError on failure", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    (fetch as any).mockResolvedValueOnce(jsonResponse({}, false, 500));
    await expect(mod.uploadImage("at", "x.png", "image/png", Buffer.from("a"))).rejects.toThrow(
      mod.GoogleDriveError,
    );
  });

  it("makeFilePublic throws on failure, resolves on success", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    (fetch as any).mockResolvedValueOnce(jsonResponse({}));
    await expect(mod.makeFilePublic("at", "file1")).resolves.toBeUndefined();

    (fetch as any).mockResolvedValueOnce(jsonResponse({}, false, 403));
    await expect(mod.makeFilePublic("at", "file1")).rejects.toThrow(mod.GoogleDriveError);
  });

  it("deleteFile never throws, even on rejection", async () => {
    setEnv();
    const mod = await import("@/lib/integrations/googleDrive");
    (fetch as any).mockRejectedValue(new Error("boom"));
    await expect(mod.deleteFile("at", "file1")).resolves.toBeUndefined();
  });

  it("directImageUrl builds a thumbnail URL", async () => {
    const mod = await import("@/lib/integrations/googleDrive");
    expect(mod.directImageUrl("file1")).toBe(
      "https://drive.google.com/thumbnail?id=file1&sz=w2000",
    );
  });
});
