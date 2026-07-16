import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/admin/backup/upload/route";

// NOTE: this route performs no auth check (admin gating is at the infra/proxy
// layer), so the standard unauth=401 case does not apply. We cover the real
// branches instead: no file (400), disallowed extension (400), successful
// .sql/.jsonl upload (200).
vi.mock("fs/promises", () => ({
  default: { mkdir: vi.fn(), writeFile: vi.fn() },
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

import fs from "fs/promises";

const base = "https://example.com/api/admin/backup/upload";

// jsdom's Request/FormData do not interop for multipart bodies, so
// req.formData() rejects. The route only needs req.formData(), so we hand the
// handler a minimal request whose formData() returns the FormData directly.
function postForm(form: FormData) {
  return { url: base, method: "POST", formData: async () => form } as unknown as Request;
}

function buildForm(fields: Array<{ name: string; value: string; filename?: string }>): FormData {
  const form = new FormData();
  for (const f of fields) {
    if (f.filename) form.set(f.name, new File([f.value], f.filename));
    else form.set(f.name, f.value);
  }
  return form;
}

describe("POST /api/admin/backup/upload", () => {
  beforeEach(() => {
    vi.mocked(fs.mkdir).mockReset().mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockReset().mockResolvedValue(undefined);
  });

  it("returns 400 when no file is provided", async () => {
    const res = await POST(postForm(buildForm([{ name: "foo", value: "bar" }])));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-sql/non-jsonl file", async () => {
    const res = await POST(postForm(buildForm([{ name: "file", value: "x", filename: "dump.txt" }])));
    expect(res.status).toBe(400);
  });

  it("uploads a .sql file successfully", async () => {
    const content = "SELECT 1;";
    const res = await POST(postForm(buildForm([{ name: "file", value: content, filename: "dump.sql" }])));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.name).toBe("dump.sql");
    expect(body.size).toBe(Buffer.byteLength(content));
    expect(fs.writeFile).toHaveBeenCalledOnce();
  });

  it("uploads a .jsonl file successfully", async () => {
    const content = '{"a":1}';
    const res = await POST(postForm(buildForm([{ name: "file", value: content, filename: "dump.jsonl" }])));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.name).toBe("dump.jsonl");
  });
});
