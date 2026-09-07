// Клиент облачной копии сохранения — см. lib/game/cloudSave.ts (сервер) за
// тем, зачем она вообще нужна.
//
// Обе функции best-effort: отсутствие сети или временная 5xx не должны
// ронять ни автосейв, ни загрузку партии — то же правило, что у остального
// синхронного слоя игры (fetchWorld, fetchListings и т.п.).
export interface CloudSavePayload {
  gameElapsedMs: number;
  payload: string;
  updatedAt: number;
}

export async function fetchCloudSave(): Promise<CloudSavePayload | null> {
  try {
    const res = await fetch("/api/game/cloudsave");
    if (!res.ok) return null;
    const data = (await res.json()) as { save: CloudSavePayload | null };
    return data.save;
  } catch {
    return null;
  }
}

/** Отправить копию. Не бросает и не ждёт долго — это фоновая подстраховка, не критичный путь. */
export async function pushCloudSave(gameElapsedMs: number, payload: string): Promise<void> {
  try {
    await fetch("/api/game/cloudsave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameElapsedMs, payload }),
    });
  } catch {
    // Один пропущенный автосейв в облако не критичен: следующий тик
    // (60 секунд) попробует снова.
  }
}
