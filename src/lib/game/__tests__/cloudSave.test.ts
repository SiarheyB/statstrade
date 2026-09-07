import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getCloudSave, putCloudSave, MAX_PAYLOAD_BYTES } from "@/lib/game/cloudSave";

// Облачная копия сохранения — без неё вход под тем же аккаунтом с ДРУГОГО
// устройства видел стартовое состояние: партия оставалась в IndexedDB того
// браузера, где играли. Здесь проверяется ровно то, ради чего она заводилась
// (копия читается на другом устройстве) и защита от отката более старой
// копией — тот же приём, что у локального сохранения в persistence/gameDb.ts.

function email(tag: string) {
  return `${tag}-${Date.now()}-${Math.round(Math.random() * 1e6)}@test.local`;
}

describe("облачная копия сохранения", () => {
  let userId: string;
  const cleanup: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email: email("cloudsave") } });
    userId = user.id;
    cleanup.push(userId);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: cleanup } } });
  });

  it("нет копии — null, а не ошибка", async () => {
    const save = await getCloudSave(userId);
    expect(save).toBeNull();
  });

  it("записанная копия читается обратно", async () => {
    const payload = JSON.stringify({ account: { balance: 12_345 } });
    const result = await putCloudSave(userId, 100_000, payload);
    expect(result).toEqual({ ok: true });
    const save = await getCloudSave(userId);
    expect(save?.payload).toBe(payload);
    expect(save?.gameElapsedMs).toBe(100_000);
  });

  it("более старая по игровому времени копия не затирает свежую", async () => {
    await putCloudSave(userId, 200_000, JSON.stringify({ v: "новая" }));
    const stale = await putCloudSave(userId, 150_000, JSON.stringify({ v: "старая" }));
    // Запись не отклоняется явной ошибкой (устройство могло автосейвиться
    // с задержкой) — она просто молча не побеждает более новую.
    expect(stale).toEqual({ ok: true });
    const save = await getCloudSave(userId);
    expect(save?.gameElapsedMs).toBe(200_000);
    expect(JSON.parse(save!.payload)).toEqual({ v: "новая" });
  });

  it("копия РОВНО с тем же игровым временем перезаписывается (последний автосейв того же момента)", async () => {
    await putCloudSave(userId, 300_000, JSON.stringify({ v: "первая" }));
    await putCloudSave(userId, 300_000, JSON.stringify({ v: "вторая" }));
    const save = await getCloudSave(userId);
    expect(JSON.parse(save!.payload)).toEqual({ v: "вторая" });
  });

  it("слишком большой пейлоад отклоняется", async () => {
    const huge = "x".repeat(MAX_PAYLOAD_BYTES + 1);
    const result = await putCloudSave(userId, 400_000, huge);
    expect(result).toEqual({ ok: false, error: "too_large" });
  });
});
