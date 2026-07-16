import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/statsCache", () => ({ bumpStatsVersion: vi.fn() }));
vi.mock("@/lib/mt/parse", () => ({
  parseStatement: vi.fn(),
}));
vi.mock("@/lib/mt/to-imported", () => ({
  toImportedTrade: vi.fn(),
}));

import {
  asGuest,
  asUser,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { parseStatement } from "@/lib/mt/parse";
import { toImportedTrade } from "@/lib/mt/to-imported";
import { POST, DELETE } from "@/app/api/accounts/[id]/import/route";

const base = "https://example.com/api/accounts/a1/import";

// jsdom's Request does not implement formData(); pass a minimal request stub
// whose formData() returns our prepared FormData.
function makeReq(form: FormData): any {
  return { formData: async () => form };
}

function makeForm(file: File, dryRun = false): FormData {
  const fd = new FormData();
  fd.set("file", file);
  if (dryRun) fd.set("dryRun", "1");
  return fd;
}

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockPrisma.exchangeAccount.findFirst.mockReset();
  mockPrisma.importedTrade.findFirst.mockReset();
  mockPrisma.importedTrade.createMany.mockReset();
  mockPrisma.importedTrade.deleteMany.mockReset();
  mockPrisma.exchangeAccount.update.mockReset();
  (parseStatement as any).mockReset();
  (toImportedTrade as any).mockReset();
});

function stubParse(trades: any[] = [{ netPnl: 5 }]) {
  (parseStatement as any).mockReturnValue({
    format: "mt4",
    trades,
    balance: 1000,
    errors: [],
  });
  (toImportedTrade as any).mockImplementation((t: any) => ({
    symbol: "EURUSD",
    side: "buy",
    lots: 0.1,
    entryTime: new Date("2024-01-01T00:00:00Z"),
    exitTime: new Date("2024-01-01T01:00:00Z"),
    entryPrice: 1,
    exitPrice: 1.1,
    pips: 10,
    swap: 0,
    commission: 0,
    netPnl: t.netPnl,
    exitTimeMs: 0,
  }));
}

describe("POST /api/accounts/[id]/import", () => {
  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(makeReq(makeForm(new File([], "r.html"))), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when account is not MT", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({
      id: "a1",
      source: "exchange",
      accountCurrency: "USD",
    });
    const res = await POST(makeReq(makeForm(new File([], "r.html"))), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when no trades parsed", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({
      id: "a1",
      source: "mt4",
      accountCurrency: "USD",
    });
    stubParse([]);
    const res = await POST(makeReq(makeForm(new File([], "r.html"))), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
  });

  it("previews parsed trades on dryRun", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({
      id: "a1",
      source: "mt4",
      accountCurrency: "USD",
    });
    stubParse([{ netPnl: 5 }]);
    const res = await POST(
      makeReq(makeForm(new File([Buffer.from("<html></html>")], "r.html"), true)),
      { params: Promise.resolve({ id: "a1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preview).toBe(true);
    expect(body.parsed).toBe(1);
  });

  it("imports parsed trades", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({
      id: "a1",
      source: "mt4",
      accountCurrency: "USD",
    });
    stubParse([{ netPnl: 5 }]);
    mockPrisma.importedTrade.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.exchangeAccount.update.mockResolvedValue({});
    const res = await POST(
      makeReq(makeForm(new File([Buffer.from("<html></html>")], "r.html"))),
      { params: Promise.resolve({ id: "a1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1);
  });
});

describe("DELETE /api/accounts/[id]/import", () => {
  it("returns 400 when no imports to roll back", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1" });
    mockPrisma.importedTrade.findFirst.mockResolvedValue(null);
    const res = await DELETE(new Request(base, { method: "DELETE" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(400);
  });

  it("rolls back latest import", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1" });
    mockPrisma.importedTrade.findFirst.mockResolvedValue({ importBatch: "b1" });
    mockPrisma.importedTrade.deleteMany.mockResolvedValue({ count: 3 });
    const res = await DELETE(new Request(base, { method: "DELETE" }), {
      params: Promise.resolve({ id: "a1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(3);
  });
});
