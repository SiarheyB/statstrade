// Облачная копия локального сохранения игры.
//
// ПОЧЕМУ ЭТО ВООБЩЕ НУЖНО. Баланс, позиции и история сделок жили только в
// IndexedDB браузера (persistence/gameDb.ts) — сервер знал только коарс-
// снапшот (equity/престиж, см. world.ts syncPlayer). Игрок, открывший игру
// на другом устройстве под тем же аккаунтом, видел стартовое состояние: его
// партия осталась в браузере, где он играл. Эта копия — то, чего не хватало
// для продолжения партии с любого устройства.
//
// ЧТО НЕ ХРАНИТСЯ. candleHistory — самая тяжёлая часть локального
// сохранения — сюда не попадает: на приёмном устройстве свечи всё равно
// перечитываются заново с общего рынка (GameCandle/marketStore), а
// синхронизировать клиентский кэш смысла нет ни для размера пейлоада, ни
// для корректности (общий рынок один на всех, кэш одного браузера ему не
// указ).
//
// КАК УСТРОЕНО. payload — JSON-строка произвольной формы (клиент сам решает,
// что в неё класть — сервер её не разбирает и не валидирует по полям,
// только по размеру). gameElapsedMs — отдельная колонка ради дешёвого
// сравнения «какая копия новее» без разбора всего JSON, тот же приём, что у
// локального сохранения в persistence/gameDb.ts.
import { prisma } from "@/lib/db";

/** Потолок размера пейлоада: без него один игрок мог бы забить таблицу. */
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024; // 2 МБ — с большим запасом на реальный размер без свечей

export interface CloudSave {
  gameElapsedMs: number;
  payload: string;
  updatedAt: number;
}

export async function getCloudSave(userId: string): Promise<CloudSave | null> {
  const row = await prisma.gameCloudSave.findUnique({
    where: { userId },
    select: { gameElapsedMs: true, payload: true, updatedAt: true },
  });
  if (!row) return null;
  return { gameElapsedMs: row.gameElapsedMs, payload: row.payload, updatedAt: row.updatedAt.getTime() };
}

export type PutCloudSaveError = "too_large";

/**
 * Записывает копию, только если она не "младше" уже лежащей — тот же приём,
 * что в persistence/gameDb.ts у локального сохранения. Без этой проверки
 * устройство, зависшее в фоне со старой вкладкой, могло бы затереть более
 * свежую партию с другого устройства своим автосейвом.
 */
export async function putCloudSave(
  userId: string,
  gameElapsedMs: number,
  payload: string,
): Promise<{ ok: true } | { ok: false; error: PutCloudSaveError }> {
  if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) return { ok: false, error: "too_large" };

  await prisma.$transaction(async (tx) => {
    const existing = await tx.gameCloudSave.findUnique({ where: { userId }, select: { gameElapsedMs: true } });
    if (existing && existing.gameElapsedMs > gameElapsedMs) return;
    await tx.gameCloudSave.upsert({
      where: { userId },
      create: { userId, gameElapsedMs, payload },
      update: { gameElapsedMs, payload },
    });
  });
  return { ok: true };
}
