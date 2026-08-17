import { describe, it, expect, vi, beforeEach } from "vitest";
import { asUser, asGuest, mockGetAuthUser } from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/orderflow/segment/route";

vi.mock("@/lib/orderflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/orderflow")>();
  return {
    ...actual,
    // Настоящие rollupLevelFor и TF_MS: по ним считается сетка выравнивания —
    // это и есть проверяемое поведение.
    computeOrderflow: vi.fn().mockResolvedValue({ maxVal: 1 }),
    computeFootprint: vi.fn().mockResolvedValue({ candles: [] }),
  };
});

const base = "https://example.com/api/orderflow/segment";
const DAY = 86_400_000;

describe("GET /api/orderflow/segment", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
  });

  it("не отдаёт данные гостю", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=1h&from=1&to=2`));
    expect(res.status).toBe(401);
  });

  it("отклоняет перевёрнутый и пустой отрезок", async () => {
    asUser();
    const to = Date.now();
    expect((await GET(new Request(`${base}?symbol=BTCUSDT&range=1h&from=${to}&to=${to - 1000}`))).status).toBe(400);
    expect((await GET(new Request(`${base}?symbol=BTCUSDT&range=1h`))).status).toBe(400);
  });

  it("отклоняет слишком широкий отрезок", async () => {
    asUser();
    const to = Date.now();
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=1h&from=${to - 20 * 365 * DAY}&to=${to}`));
    expect(res.status).toBe(400);
  });

  it("выравнивает границы по сетке уровня агрегатов", async () => {
    asUser();
    // Год шириной → дневной уровень → границы округляются до суток.
    const to = Date.now();
    const from = to - 365 * DAY;
    const res = await GET(new Request(`${base}?symbol=BTCUSDT&range=1d&from=${from}&to=${to}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.from % DAY).toBe(0);
    expect(body.to % DAY).toBe(0);
    // Отрезок только расширяется наружу — иначе на стыке с соседним куском
    // истории осталась бы незакрашенная полоса.
    expect(body.from).toBeLessThanOrEqual(from);
    expect(body.to).toBeGreaterThanOrEqual(to);
  });

  it("соседние запросы внутри одной сетки считаются один раз", async () => {
    asUser();
    const { computeOrderflow } = await import("@/lib/orderflow");
    const calls = () => (computeOrderflow as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const to = Date.now();
    const from = to - 400 * DAY;

    await GET(new Request(`${base}?symbol=ETHUSDT&range=1d&from=${from}&to=${to}`));
    const after = calls();
    // Прокрутка сдвинула запрос на несколько минут — внутри тех же суток, то
    // есть после выравнивания это ровно тот же отрезок.
    await GET(new Request(`${base}?symbol=ETHUSDT&range=1d&from=${from + 60_000}&to=${to - 60_000}`));
    expect(calls()).toBe(after);
  });
});
