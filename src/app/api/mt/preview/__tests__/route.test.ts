import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
} from "@/lib/__tests__/helpers/routeMocks";
import { POST } from "@/app/api/mt/preview/route";

const parseStatement = vi.fn();
const toImportedTrade = vi.fn();

vi.mock("@/lib/mt/parse", () => ({
  parseStatement: (...a: unknown[]) => parseStatement(...a),
}));
vi.mock("@/lib/mt/to-imported", () => ({
  toImportedTrade: (...a: unknown[]) => toImportedTrade(...a),
}));

const base = "https://example.com/api/mt/preview";

function makeFile(contents: string): File {
  return new File([contents], "report.html", { type: "text/html" });
}

// jsdom's Request/FormData do not interop for multipart bodies, so
// req.formData() rejects. The route only needs req.formData(), so we hand the
// handler a minimal request whose formData() returns the FormData directly.
function postForm(url: string, form: FormData) {
  return { url, method: "POST", formData: async () => form } as unknown as Request;
}

describe("POST /api/mt/preview", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    parseStatement.mockReset();
    toImportedTrade.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const form = new FormData();
    form.set("file", makeFile("<html></html>"));
    const res = await POST(postForm(base, form));
    expect(res.status).toBe(401);
  });

  it("returns 400 when no file is provided", async () => {
    asUser();
    const res = await POST(postForm(base, new FormData()));
    expect(res.status).toBe(400);
  });

  it("returns 400 when no trades are found", async () => {
    asUser();
    parseStatement.mockReturnValue({
      format: "mt4" as const,
      trades: [],
      balance: null,
      errors: ["В файле не найдено закрытых сделок"],
    });
    const form = new FormData();
    form.set("file", makeFile("<html></html>"));
    form.set("source", "mt4");
    const res = await POST(postForm(base, form));
    expect(res.status).toBe(400);
  });

  it("returns 200 with parsed preview on success", async () => {
    asUser();
    const exitTime = new Date("2024-01-01T12:00:00Z");
    parseStatement.mockReturnValue({
      format: "mt4" as const,
      trades: [{ id: "t1", exitTime } as any],
      balance: 1000,
      errors: [],
    });
    toImportedTrade.mockReturnValue({
      symbol: "EURUSD",
      side: "long" as const,
      lots: 1.0,
      exitTime,
      pips: 100,
      netPnl: 95,
    } as any);
    const form = new FormData();
    form.set("file", makeFile("<html></html>"));
    form.set("source", "mt4");
    const res = await POST(postForm(base, form));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.format).toBe("mt4");
    expect(body.parsed).toBe(1);
    expect(body.symbols).toContain("EURUSD");
    expect(body.netTotal).toBe(95);
    expect(body.balance).toBe(1000);
    expect(Array.isArray(body.sample)).toBe(true);
  });
});
