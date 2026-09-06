// Локальное сохранение игры — раздел 12 спеки, через Dexie (IndexedDB).
// Один слот сохранения на браузер (Фаза 1 не предполагает несколько
// партий/профилей — при необходимости достаточно завести несколько строк
// по ключу вместо переделки схемы).
import Dexie, { type Table } from "dexie";
import type { SaveGame } from "@/engine/entities/types";

const CURRENT_SAVE_ID = "current";

interface SaveRow extends SaveGame {
  id: string;
}

class TradingGameDB extends Dexie {
  saves!: Table<SaveRow, string>;

  constructor() {
    super("TradingGameDB");
    this.version(1).stores({
      // Единственное индексируемое поле — первичный ключ; остального
      // Dexie не индексирует, храним как есть (структурированные клоны).
      saves: "id",
    });
  }
}

// Ленивая инициализация: Dexie трогает indexedDB при создании инстанса, а
// этот модуль может импортироваться в SSR-контексте (Next.js рендерит
// страницу и на сервере) — там indexedDB не существует.
let dbInstance: TradingGameDB | null = null;
function getDb(): TradingGameDB | null {
  if (typeof indexedDB === "undefined") return null;
  if (!dbInstance) dbInstance = new TradingGameDB();
  return dbInstance;
}

export async function loadGame(): Promise<SaveGame | null> {
  const db = getDb();
  if (!db) return null;
  const row = await db.saves.get(CURRENT_SAVE_ID);
  if (!row) return null;
  const { id: _id, ...save } = row;
  return save;
}

/**
 * Пишет сохранение, только если оно не "младше" уже лежащего в IndexedDB
 * (по gameElapsedMs). Без этой защиты два независимых тикера на одном
 * источнике — вторая вкладка игры, ИЛИ (в дев-режиме) осиротевший
 * setInterval от предыдущей версии модуля после Fast Refresh правки
 * gameStore.ts/gameLoop.ts, — периодически перезаписывали бы сохранение
 * друг у друга более старым состоянием: следующая сессия загружала бы уже
 * пройденный отрезок игрового времени и продолжала бы дописывать свечи с
 * метками времени МЕНЬШЕ уже сохранённых — график полу­чал бы две (или
 * больше) перемешанных "дорожки" истории (см. также PriceChart.tsx —
 * защита и на чтении, на случай если что-то подобное уже записано).
 * IndexedDB-транзакция делает read-compare-write атомарным — не гонка
 * между параллельными saveGame() из разных вкладок.
 */
export async function saveGame(save: SaveGame): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.transaction("rw", db.saves, async () => {
    const current = await db.saves.get(CURRENT_SAVE_ID);
    if (current && current.gameElapsedMs > save.gameElapsedMs) return;
    await db.saves.put({ ...save, id: CURRENT_SAVE_ID });
  });
}

export async function deleteSave(): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.saves.delete(CURRENT_SAVE_ID);
}
