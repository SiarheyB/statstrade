import { describe, it, expect, vi, beforeEach } from "vitest";

// NOTE: this route (like backup/upload) performs no auth check itself —
// admin gating happens at the infra/proxy layer — so there is no 401/403
// branch to cover here. We focus on action routing, validation, and the
// fs/child_process error branches.

vi.mock("fs/promises", () => ({
  default: {
    access: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
  },
}));

const mockOn = vi.fn();
const mockChild = {
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
  on: vi.fn(),
};
vi.mock("child_process", () => {
  const spawn = vi.fn(() => mockChild);
  return { default: { spawn }, spawn };
});

import fs from "fs/promises";
import { spawn } from "child_process";
import { GET, POST, DELETE } from "../route.js";

const base = "https://example.com/api/admin/backup";

describe("GET /api/admin/backup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.access.mockResolvedValue(undefined);
  });

  it("returns 400 for an invalid/missing action", async () => {
    const res = await GET(new Request(base));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("lists .sql/.jsonl files under action=list", async () => {
    fs.readdir.mockResolvedValue(["a.sql", "b.jsonl", "c.txt"]);
    fs.stat.mockResolvedValue({ size: 123, mtime: new Date(1000) });
    const res = await GET(new Request(`${base}?action=list`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(2);
    expect(body.files[0].name).toBe("a.sql");
  });

  it("returns 500 when listing files fails", async () => {
    fs.readdir.mockRejectedValue(new Error("disk error"));
    const res = await GET(new Request(`${base}?action=list`));
    expect(res.status).toBe(500);
  });

  it("returns 404 for unknown operationId", async () => {
    const res = await GET(new Request(`${base}?operationId=nope`));
    expect(res.status).toBe(404);
  });

  it("returns operation status after a POST created it", async () => {
    const postRes = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ action: "backup" }) }),
    );
    const { operationId } = await postRes.json();

    const res = await GET(new Request(`${base}?operationId=${operationId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBeDefined();
    expect(Array.isArray(body.logs)).toBe(true);
  });

  it("returns logs for action=logs with a known operationId", async () => {
    const postRes = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ action: "backup" }) }),
    );
    const { operationId } = await postRes.json();

    const res = await GET(new Request(`${base}?action=logs&operationId=${operationId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.logs)).toBe(true);
  });

  it("returns 404 for action=logs with unknown operationId", async () => {
    const res = await GET(new Request(`${base}?action=logs&operationId=nope`));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/backup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.access.mockResolvedValue(undefined);
  });

  it("returns 400 when action is missing", async () => {
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });

  it("starts an operation and spawns the backup script", async () => {
    const res = await POST(
      new Request(base, { method: "POST", body: JSON.stringify({ action: "backup" }) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.operationId).toBe("string");
    expect(spawn).toHaveBeenCalledWith(
      "bash",
      expect.arrayContaining(["backup"]),
      expect.any(Object),
    );
  });

  it("passes a file argument through to the script when file is provided", async () => {
    await POST(
      new Request(base, {
        method: "POST",
        body: JSON.stringify({ action: "restore", file: "dump.sql" }),
      }),
    );
    expect(spawn).toHaveBeenCalled();
    const args = spawn.mock.calls[0][1];
    expect(args).toContain("restore");
    expect(args.some((a) => a.includes("dump.sql"))).toBe(true);
  });

  it("returns 500 when the request body cannot be parsed", async () => {
    const res = await POST(new Request(base, { method: "POST", body: "not-json" }));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/admin/backup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.access.mockResolvedValue(undefined);
    fs.unlink.mockResolvedValue(undefined);
    fs.readdir.mockResolvedValue([]);
  });

  it("deletes the log file when action=clear-logs", async () => {
    const res = await DELETE(
      new Request(base, { method: "DELETE", body: JSON.stringify({ action: "clear-logs" }) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(fs.unlink).toHaveBeenCalled();
  });

  it("returns 500 when clear-logs fails to unlink", async () => {
    fs.unlink.mockRejectedValue(new Error("no such file"));
    const res = await DELETE(
      new Request(base, { method: "DELETE", body: JSON.stringify({ action: "clear-logs" }) }),
    );
    expect(res.status).toBe(500);
  });

  it("clears all files when action=clear-all", async () => {
    fs.readdir.mockResolvedValue(["a.sql", "b.jsonl"]);
    const res = await DELETE(
      new Request(base, { method: "DELETE", body: JSON.stringify({ action: "clear-all" }) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(fs.unlink).toHaveBeenCalledTimes(2);
  });

  it("returns 400 when deleting a single file without a filename", async () => {
    const res = await DELETE(
      new Request(base, { method: "DELETE", body: JSON.stringify({ action: "delete-file" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("deletes a single file by filename", async () => {
    const res = await DELETE(
      new Request(base, {
        method: "DELETE",
        body: JSON.stringify({ action: "delete-file", filename: "a.sql" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 500 when deleting a single file fails", async () => {
    fs.access.mockResolvedValue(undefined);
    fs.unlink.mockRejectedValue(new Error("permission denied"));
    const res = await DELETE(
      new Request(base, {
        method: "DELETE",
        body: JSON.stringify({ action: "delete-file", filename: "a.sql" }),
      }),
    );
    expect(res.status).toBe(500);
  });

  it("falls back to the file query param when the body cannot be parsed", async () => {
    const res = await DELETE(
      new Request(`${base}?file=a.sql`, { method: "DELETE", body: "not-json" }),
    );
    expect(res.status).toBe(200);
  });
});
